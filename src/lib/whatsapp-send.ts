/**
 * Sending through the WhatsApp API: rebuild, refuse a double, send, log, tick.
 *
 * SERVER ONLY — imports the database and lib/aisensy.ts.
 *
 * NOTHING HERE TAKES MESSAGE TEXT FROM THE CALLER. A button on the batch page
 * or the dashboard hands over an id — the round and the card, or the teacher
 * and the round — and this file rebuilds the card on the server from the same
 * functions the page used to draw it: getBatch → toQueueLinks →
 * groupLinksByRecipient for a send, listRequests → pendingForBoard →
 * groupRemindersByTeacher for a chase. So the message that goes out is, by
 * construction, the one the card described, and a stale tab cannot send last
 * week's list.
 *
 * NO SESSION, NO revalidatePath, NO headers(). The server actions that wrap
 * these functions do the role check and the revalidation; this file takes an
 * `actor` that may be null, so a scheduled send can call it later without a
 * signed-in user and without a second implementation.
 *
 * THE DOUBLE-SEND GUARD IS HERE, NOT ON THE SCREEN. Two people chasing the
 * same teacher from two corridors is the case reminder_count was built for,
 * and a check that lives in the button is a check one of them does not have.
 * A card already ticked today is refused unless the caller says `force`, which
 * only an explicit "Send again" passes.
 *
 * ORDER: send → log → tick. A failed send is logged and never ticked. A send
 * that succeeded and then failed to tick is still reported as sent, with a
 * warning — the log row is the record, and telling the office "not sent" about
 * a message the teacher is already reading is the worse lie.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import {
  campaignFor,
  destinationFor,
  isApiConfigured,
  sendTemplate,
} from "./aisensy";
import { findMasterLink, getBatch, markGroupReminded, markGroupSent } from "./batches";
import {
  getOfficeRecipient,
  MASTER_AUDIENCE_KIND,
  OFFICE_AUDIENCE_LABEL,
} from "./office";
import { isCompletePhone, normalisePhone } from "./phone";
import { listRequests, pendingForBoard } from "./requests";
import { groupRemindersByTeacher } from "./reminders";
import { groupLinksByRecipient, toQueueLinks } from "./send-queue";
import { todayISO } from "./today";
import { logMessage } from "./whatsapp-log";
import {
  DEFAULT_LANGUAGE,
  buildLinkPayload,
  buildReminderPayloads,
  buildRequestPayloads,
  buildTestPayload,
  isLanguage,
  type Language,
  type TemplatePayload,
} from "./whatsapp-templates";

export type SendOutcome =
  | { ok: true; messages: number; warning: string | null }
  | { ok: false; error: string };

/** The one sentence every refusal starts from when the key is unset. */
const NOT_CONFIGURED = "WhatsApp API sending is switched off on this deployment.";

/**
 * The two reason columns as one value, or null when the round has none.
 *
 * Takes the two columns rather than a row type so that it serves a batch row, a
 * request row and a board row alike — all three carry the same pair, for the
 * reason given on requests.reason_en.
 */
function reasonOf(row: {
  reasonEn: string | null;
  reasonHi: string | null;
}): { en: string; hi: string } | undefined {
  if (!row.reasonEn && !row.reasonHi) return undefined;
  return { en: row.reasonEn ?? "", hi: row.reasonHi ?? "" };
}

/**
 * Which template language she gets. Read here, once per send, rather than
 * carried on every board row — RequestBoardRow is built literally by a dozen
 * test fixtures, and a new required field there is a dozen edits for a value
 * one function needs.
 */
export async function languageFor(teacherId: string): Promise<Language> {
  const [row] = await db
    .select({ language: schema.teachers.language })
    .from(schema.teachers)
    .where(eq(schema.teachers.id, teacherId))
    .limit(1);
  return row && isLanguage(row.language) ? row.language : DEFAULT_LANGUAGE;
}

/**
 * Has this card already gone out today?
 *
 * Pure, so the rule is testable: a send is a double when every link on the
 * card is already ticked; a chase is a double when today's chase already
 * reached her. Both are the "every" rule the queues themselves use.
 */
export function alreadySentToday(card: { links: { sent: boolean }[] }): boolean {
  return card.links.length > 0 && card.links.every((link) => link.sent);
}

type Deliver = {
  payloads: TemplatePayload[];
  teacherId: string | null;
  teacherName: string;
  phone: string;
  batchId: string | null;
  actor: string | null;
  /** Called once per successful message with the requests it covered. */
  tick: (requestIds: string[]) => Promise<void>;
};

/**
 * Put the payloads on the wire one at a time, logging each.
 *
 * Sequential, not Promise.all: a card that splits into three messages should
 * arrive in order, and a refusal on the first (a paused template, a bad
 * number) should stop the rest rather than produce three identical errors.
 */
async function deliver(input: Deliver): Promise<SendOutcome> {
  const destination = destinationFor(input.phone);
  if (!destination) {
    return { ok: false, error: `${input.phone || "(no number)"} is not a ten-digit mobile number.` };
  }

  let sent = 0;
  let warning: string | null = null;

  for (const payload of input.payloads) {
    const campaignName = campaignFor(payload.kind, payload.language);
    const result = await sendTemplate({
      campaignName,
      destination,
      userName: input.teacherName,
      templateParams: payload.params,
      buttonSuffix: payload.suffix,
    });

    await logMessage({
      kind: payload.kind,
      campaignName,
      language: payload.language,
      teacherId: input.teacherId,
      phone: destination.slice(3),
      requestIds: payload.requestIds,
      batchId: input.batchId,
      templateParams: payload.params,
      buttonSuffix: payload.suffix,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error,
      providerResponse: result.raw,
      sentBy: input.actor,
    });

    if (!result.ok) {
      const prefix = sent > 0 ? `${sent} of ${input.payloads.length} sent, then: ` : "";
      return { ok: false, error: `${prefix}${result.error}` };
    }

    sent += 1;
    if (payload.requestIds.length > 0) {
      try {
        await input.tick(payload.requestIds);
      } catch (error) {
        warning =
          error instanceof Error
            ? `Sent, but could not record it: ${error.message}`
            : "Sent, but could not record it.";
      }
    }
  }

  return { ok: true, messages: sent, warning };
}

/* ============ THE ROUND'S SEND QUEUE ============ */

/**
 * One card of the send queue, through the API.
 *
 * `groupKey` is `teacherId|phone` — the card's identity, and deliberately not
 * a list of request ids: the message must carry EVERY link on the card,
 * including any already ticked, or she receives a second, different message
 * for the same round with no way to reconcile the two (SendQueue.tsx says the
 * same about the manual href).
 */
export async function sendRoundGroup(input: {
  batchId: string;
  groupKey: string;
  actor: string | null;
  force?: boolean;
}): Promise<SendOutcome> {
  if (!isApiConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const detail = await getBatch(input.batchId);
  if (!detail) return { ok: false, error: "That round no longer exists." };

  const group = groupLinksByRecipient(toQueueLinks(detail.links)).find(
    (candidate) => candidate.key === input.groupKey,
  );
  if (!group) return { ok: false, error: "That card is no longer in the queue." };

  if (!input.force && alreadySentToday(group)) {
    return { ok: false, error: "Already sent. Untick the card, or choose Send again." };
  }

  const language = await languageFor(group.teacherId);
  const payloads = buildRequestPayloads({
    teacherName: group.teacherName,
    language,
    title: detail.batch.title,
    dueDate: detail.batch.dueDate,
    links: group.links.map((link) => ({
      requestId: link.requestId,
      token: link.token,
      fieldKeys: link.fieldKeys,
      audience: {
        kind: link.audienceKind,
        label: link.audienceLabel,
        fieldKeys: link.fieldKeys,
        classLabels: link.classLabels,
        // Off the round, not off the link: every link in a round carries the
        // same one, and buildRequestPayloads hoists it above the numbered list
        // when a teacher holds several.
        reason: reasonOf(detail.batch),
      },
    })),
    linkToken: group.linkToken,
  });

  return deliver({
    payloads,
    teacherId: group.teacherId,
    teacherName: group.teacherName,
    phone: group.phone,
    batchId: input.batchId,
    actor: input.actor,
    tick: (requestIds) => markGroupSent(requestIds, input.actor, true),
  });
}

/* ============ THE ROUND'S OWN LINK ============ */

/**
 * Hand the master link over — to the office by default, or to a typed number.
 *
 * IT REUSES THE `request` TEMPLATE, unchanged and un-re-approved. "Namaste
 * Office ji, please check Student photos for All classes (504 children). Due:
 * 5 Sep." is exactly what this message has to say, and a template is approved
 * once and cannot be edited — so a seventh template would have been a week of
 * Meta review to say the same sentence. describeAudience* carries the count.
 *
 * `linkToken: null` IS LOAD-BEARING. It forces suffixFor into `single` mode, so
 * the button carries this round's master token. Passing the office's durable
 * page token instead would make the button point at the page for some rounds
 * and at the link for others — one button, two destinations, depending on a
 * field the sender cannot see.
 *
 * NO DOUBLE-SEND GUARD, unlike sendRoundGroup. Sending the same link to a
 * second person is not a mistake here, it is the feature: the office forwards
 * it to whoever is actually doing the round. Every send writes its own
 * whatsapp_messages row naming the number and the sender, which is the record
 * that matters.
 */
export async function sendMasterLink(input: {
  batchId: string;
  /** A number to send to instead of the office's. Ten digits. */
  phone?: string | null;
  actor: string | null;
}): Promise<SendOutcome> {
  if (!isApiConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const [batch] = await db
    .select()
    .from(schema.requestBatches)
    .where(eq(schema.requestBatches.id, input.batchId))
    .limit(1);
  if (!batch) return { ok: false, error: "That round no longer exists." };

  const master = await findMasterLink(input.batchId);
  if (!master) {
    return { ok: false, error: "This round has no master link yet." };
  }

  const office = await getOfficeRecipient();
  if (!office) {
    return { ok: false, error: "No office number is set. Settings → Office." };
  }

  const phone = input.phone ? normalisePhone(input.phone) : office.phone;
  if (!isCompletePhone(phone)) {
    return { ok: false, error: "A phone number is 10 digits, with no country code." };
  }

  const language = isLanguage(office.language) ? office.language : DEFAULT_LANGUAGE;

  const payloads = buildRequestPayloads({
    teacherName: office.name,
    language,
    title: batch.title,
    dueDate: batch.dueDate,
    links: [
      {
        requestId: master.requestId,
        token: master.token,
        fieldKeys: batch.fieldKeys,
        audience: {
          kind: MASTER_AUDIENCE_KIND,
          label: OFFICE_AUDIENCE_LABEL,
          fieldKeys: batch.fieldKeys,
          rosterSize: master.rosterSize,
          reason: reasonOf(batch),
        },
      },
    ],
    linkToken: null,
  });

  return deliver({
    payloads,
    teacherId: office.id,
    teacherName: office.name,
    phone,
    batchId: input.batchId,
    actor: input.actor,
    // "The office was handed this link", which is true of whichever number it
    // went to. Who exactly, and when, is every row in whatsapp_messages.
    tick: (requestIds) => markGroupSent(requestIds, input.actor, true),
  });
}

/* ============ THE CHASE ============ */

/**
 * One teacher's reminder, through the API.
 *
 * `teacherKey` is the same `teacherId|phone`. With `batchId` the nudge covers
 * what she owes in that round (RoundNudge); without it, everything she owes
 * (the dashboard and /requests). Both are what the corresponding screen's
 * Remind button describes, because both are built by the same three calls
 * those screens make.
 */
export async function sendTeacherReminder(input: {
  teacherKey: string;
  batchId?: string | null;
  actor: string | null;
  force?: boolean;
}): Promise<SendOutcome> {
  if (!isApiConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const today = todayISO();
  const rows = await listRequests(input.batchId ? { batchId: input.batchId } : {});
  const open = rows.filter((row) => row.status === "open");
  const reminder = groupRemindersByTeacher(open, today, await pendingForBoard(open)).find(
    (candidate) => candidate.key === input.teacherKey,
  );
  if (!reminder) return { ok: false, error: "She has nothing outstanding any more." };

  if (!input.force && reminder.remindedToday) {
    return { ok: false, error: "Already reminded today. Untick her, or choose Send again." };
  }

  const language = await languageFor(reminder.teacherId);
  const payloads = buildReminderPayloads({
    teacherName: reminder.teacherName,
    language,
    linkToken: reminder.linkToken,
    items: reminder.forms.map((form) => ({
      requestId: form.requestId,
      token: form.token,
      fieldKeys: form.fieldKeys,
      audience: {
        kind: form.audienceKind,
        label: form.audienceLabel,
        fieldKeys: form.fieldKeys,
        reason: reasonOf(form),
      },
      title: form.title,
      dueDate: form.dueDate,
      answered: form.answered,
      rosterSize: form.rosterSize,
      pending: form.pending,
    })),
  });

  return deliver({
    payloads,
    teacherId: reminder.teacherId,
    teacherName: reminder.teacherName,
    phone: reminder.phone,
    batchId: input.batchId ?? null,
    actor: input.actor,
    tick: (requestIds) => markGroupReminded(requestIds, input.actor, true, today),
  });
}

/* ============ HER DURABLE PAGE ============ */

/** Hand over her personal link. Nothing to tick: a page is not a request. */
export async function sendTeacherLink(input: {
  teacherId: string;
  actor: string | null;
}): Promise<SendOutcome> {
  if (!isApiConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const [teacher] = await db
    .select()
    .from(schema.teachers)
    .where(eq(schema.teachers.id, input.teacherId))
    .limit(1);
  if (!teacher) return { ok: false, error: "No such teacher." };
  if (!teacher.linkToken) return { ok: false, error: "She has no personal link to send. Issue one first." };

  const language = isLanguage(teacher.language) ? teacher.language : DEFAULT_LANGUAGE;
  return deliver({
    payloads: [
      buildLinkPayload({ teacherName: teacher.name, language, linkToken: teacher.linkToken }),
    ],
    teacherId: teacher.id,
    teacherName: teacher.name,
    phone: teacher.phone,
    batchId: null,
    actor: input.actor,
    tick: async () => {},
  });
}

/* ============ THE TEST SEND ============ */

/**
 * A request message with invented values to any number, so the office can
 * prove the campaign, the params and the button line up before a teacher
 * receives one. Logged as `request` with no teacher and no requests.
 */
export async function sendTest(input: {
  phone: string;
  language: Language;
  actor: string | null;
}): Promise<SendOutcome> {
  if (!isApiConfigured()) return { ok: false, error: NOT_CONFIGURED };

  return deliver({
    payloads: [buildTestPayload(input.language)],
    teacherId: null,
    teacherName: "Sampark test",
    phone: input.phone,
    batchId: null,
    actor: input.actor,
    tick: async () => {},
  });
}

/**
 * What one send in a bulk chase actually counts as.
 *
 * PURE, EXPORTED AND TESTED, because it is the one piece of the "remind
 * everyone" loop that can be wrong without failing loudly. A refusal reading
 * "Already reminded today" is not a failure — it is the double-send guard doing
 * its job, and it is what makes a second tap of that button a no-op rather than
 * a second message to sixteen people. Counting it as an error would put a red
 * line under a run that went perfectly, and an office taught to ignore the red
 * line is an office that misses the real one.
 *
 * Matched on the provider-independent sentences THIS codebase writes in
 * sendTeacherReminder, never on anything AiSensy returns: those are the two
 * strings above it, and a test pins them.
 */
export function reminderVerdict(
  outcome: SendOutcome,
): "sent" | "skipped" | "failed" {
  if (outcome.ok) return "sent";
  return /already reminded|nothing outstanding/i.test(outcome.error)
    ? "skipped"
    : "failed";
}
