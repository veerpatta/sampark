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
  fieldKeys: string[];
  dueDate: string;
  /** This one request's own link, for a teacher with no durable page. */
  token: string;
  answered: number;
  rosterSize: number;
  overdue: boolean;
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
): TeacherReminder[] {
  return groupProgressByTeacher(rows, NO_MARKS_KEYS, today)
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
      fieldKeys: form.fieldKeys,
      dueDate: form.dueDate,
      token: form.token,
      answered: form.answered,
      rosterSize: form.rosterSize,
      overdue: form.overdue,
    })),
    overdue: forms.some((form) => form.overdue),
    outstanding: forms.reduce(
      (sum, form) => sum + Math.max(0, form.rosterSize - form.answered),
      0,
    ),
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
