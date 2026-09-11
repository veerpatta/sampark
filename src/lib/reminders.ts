import type { PendingStudent } from "./pending";
import { isoDay } from "./today";
import { groupProgressByTeacher, type TeacherProgress } from "./progress";
import type { RequestBoardRow } from "./requests";

/**
 * What each teacher still owes, collapsed into one nudge per person.
 *
 * THE BUG THIS EXISTS TO FIX. The dashboard used to show one row per group and
 * put a Remind button on every one of them. A teacher who takes maths for three
 * classes therefore had three buttons, and pressing them sent her three
 * near-identical WhatsApp messages inside a few seconds. From her end that is
 * not three reminders — it is one person spamming her, and the reasonable
 * response is to stop reading any of them. The office could not see it happen
 * either, because each row only knew about itself.
 *
 * PURE, and no database import, for the same reason lib/send-queue.ts is: the
 * grouping rule is the part that can be subtly wrong, and it should be testable
 * without a connection.
 */

/** One outstanding form, as the dashboard needs it. */
export type PendingForm = {
  requestId: string;
  title: string;
  audienceKind: string;
  audienceLabel: string;
  /** Why this link is only part of a register, so the nudge says it too. */
  reasonEn: string | null;
  reasonHi: string | null;
  fieldKeys: string[];
  dueDate: string;
  /** This one request's own link, for a teacher with no durable page. */
  token: string;
  answered: number;
  rosterSize: number;
  overdue: boolean;
  /** Who is still missing. Three-state — see ProgressForm.pending. */
  pending: PendingStudent[] | null | undefined;
};

export type TeacherReminder = {
  /** `teacherId|phone` — stable, and safe to use as a React key. */
  key: string;
  teacherId: string;
  teacherName: string;
  /** The number this nudge actually goes to. */
  phone: string;
  /** True when a contact_phone override sent this somewhere other than her saved number. */
  overridden: boolean;
  /** Her durable page token, when she has one. */
  linkToken: string | null;
  forms: PendingForm[];
  /** Any form past its due date — what sorts her to the top. */
  overdue: boolean;
  /** Children still unanswered for across every form she owes. */
  outstanding: number;
  /** Today's chase has already reached her — see TeacherProgress.remindedToday. */
  remindedToday: boolean;
  /** The most recent chase on what she still owes. Null if never. */
  lastRemindedAt: Date | null;
  /** The most times any one of those links has been chased. */
  reminderCount: number;
  /**
   * The links this nudge covers, for the tick that records it.
   *
   * The message goes to her once and carries all of them, so all of them are
   * equally chased — which is why markGroupReminded takes a list and not an id.
   */
  requestIds: string[];
};

/**
 * Group the open, unfinished requests into one entry per teacher.
 *
 * KEYED BY ID AND NUMBER, NEVER BY NAME — the same rule, and the same two
 * reasons, as groupLinksByRecipient in lib/send-queue.ts. Two teachers can
 * share a name, and a request carrying a contact_phone override is deliberately
 * going somewhere else (she is on leave and her sister is covering that one
 * section). Folding an overridden request into her saved-number entry would put
 * it in a message sent to the wrong phone, which is the single failure
 * requests.contact_phone exists to prevent. So it gets its own entry, labelled
 * with the number it is really going to.
 *
 * `done` is passed in rather than recomputed so this file does not acquire a
 * second opinion about what "answered" means — that definition lives in
 * coveredStudentsQuery and has already been wrong once.
 */
export function groupRemindersByTeacher(
  rows: RequestBoardRow[],
  today: string,
  /** Who is still missing, per request id. See groupProgressByTeacher. */
  pending?: ReadonlyMap<string, PendingStudent[] | null>,
): TeacherReminder[] {
  return groupProgressByTeacher(rows, NO_MARKS_KEYS, today, pending)
    .map(toReminder)
    .filter((entry): entry is TeacherReminder => entry !== null);
}

/**
 * A reminder is a progress entry with the finished work taken out.
 *
 * The grouping rule — keyed by id and phone, sorted overdue-then-outstanding —
 * now lives in ONE place instead of two near-identical loops that had to be
 * kept in step by hand. What stays here is the one thing a reminder needs and a
 * progress board does not: buildRoundReminderMessage says "3 lists are still
 * pending", so it must be handed only the lists that are.
 *
 * Returns null for a teacher with nothing outstanding, which is how she leaves
 * the chase list entirely rather than appearing in it with an empty message.
 */
export function toReminder(entry: TeacherProgress): TeacherReminder | null {
  const forms = entry.forms.filter((form) => !form.done);
  if (forms.length === 0) return null;

  return {
    key: entry.key,
    teacherId: entry.teacherId,
    teacherName: entry.teacherName,
    phone: entry.phone,
    overridden: entry.overridden,
    linkToken: entry.linkToken,
    forms: forms.map((form) => ({
      requestId: form.requestId,
      title: form.title,
      audienceKind: form.audienceKind,
      audienceLabel: form.audienceLabel,
      reasonEn: form.reasonEn,
      reasonHi: form.reasonHi,
      fieldKeys: form.fieldKeys,
      dueDate: form.dueDate,
      token: form.token,
      answered: form.answered,
      rosterSize: form.rosterSize,
      overdue: form.overdue,
      pending: form.pending,
    })),
    overdue: forms.some((form) => form.overdue),
    outstanding: forms.reduce(
      (sum, form) => sum + Math.max(0, form.rosterSize - form.answered),
      0,
    ),
    /**
     * Carried straight off the progress entry rather than recomputed.
     *
     * groupProgressByTeacher already rolls this up over exactly the unfinished
     * forms, which is the same set `forms` above holds — so recomputing it here
     * would be a second implementation of one rule that could only ever drift.
     */
    remindedToday: entry.remindedToday,
    lastRemindedAt: entry.lastRemindedAt,
    reminderCount: entry.reminderCount,
    requestIds: forms.map((form) => form.requestId),
  };
}

/**
 * A reminder does not care which kind of work it is.
 *
 * classifyForm needs the registry's marks keys, and reading the registry to
 * build a nudge that never mentions the distinction would put a database call
 * behind a pure function. Everything lands in `details`, which this file never
 * looks at.
 */
const NO_MARKS_KEYS: ReadonlySet<string> = new Set();

/**
 * MOVED OUT OF RemindButton.tsx, WHICH IS A CLIENT COMPONENT.
 *
 * TeacherProgressList renders on the server and calls this, and importing a
 * plain function across that boundary does not give you the function — it gives
 * you a client reference, and calling it throws "Attempted to call
 * remindedLabel() from the server". That took down / and /requests for every
 * logged-in user the moment the reminder columns existed to render.
 *
 * It lives here because it is pure and both sides need it: this file already
 * has a server caller and a client one. Nothing below touches the DOM, React,
 * or the database — isoDay hardcodes the school's zone precisely so it is safe
 * in a browser too.
 */
/**
 * When she was last chased, in words.
 *
 * ON ITS OWN LINE wherever this is used, never beside her name.
 * TeacherProgressList's header records that two counts sharing that line cost
 * more than the 4px rail design-qa.md removed for truncating names at 360px.
 *
 * Says the word as well as any colour, per the same rule the tone pills follow:
 * this gets read on a phone in a corridor, and somebody who cannot separate the
 * amber from the red still has to know who has already been chased today.
 */
export function remindedLabel(teacher: {
  remindedToday: boolean;
  lastRemindedAt: Date | null;
  reminderCount: number;
  /** The school's today, from the server — never computed in the browser. */
  today: string;
}): string | null {
  if (teacher.lastRemindedAt === null) return null;

  const times =
    teacher.reminderCount > 1 ? ` · nudged ${teacher.reminderCount}×` : "";
  if (teacher.remindedToday) return `reminded today${times}`;

  const days = daysBetween(teacher.lastRemindedAt, teacher.today);
  if (days <= 0) return `reminded today${times}`;
  return `reminded ${days} ${days === 1 ? "day" : "days"} ago${times}`;
}

/**
 * Whole days between a timestamp and the school's today.
 *
 * Both sides are reduced to a calendar date first, so "yesterday evening" reads
 * as 1 day rather than 0 — the office thinks in days on the register, not in
 * elapsed hours.
 *
 * THE INSTANT IS REDUCED THROUGH isoDay, NOT toISOString. `toISOString` gives the
 * UTC date, and lib/today.ts exists because that is a different day from the
 * school's for five and a half hours out of every twenty-four — a chase recorded
 * at 1am IST would have read as "1 day ago" the moment it was made. isoDay is
 * pure and safe on the client, which is the whole reason that file hardcodes the
 * zone instead of reading an env var.
 */
function daysBetween(at: Date, today: string): number {
  const then = Date.parse(`${isoDay(at)}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((now - then) / 86_400_000);
}
