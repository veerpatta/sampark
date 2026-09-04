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
import { getBatch, markGroupReminded, markGroupSent } from "./batches";
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
