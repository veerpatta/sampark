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
  const groups = new Map<string, TeacherReminder>();

  for (const row of rows) {
    if (row.status !== "open") continue;
    // Finished work is not something to nudge about.
    if (row.rosterSize > 0 && row.studentsAnswered >= row.rosterSize) continue;

    const key = `${row.teacherId}|${row.teacherPhone}`;
    const entry = groups.get(key) ?? {
      key,
      teacherId: row.teacherId,
      teacherName: row.teacher,
      phone: row.teacherPhone,
      overridden: Boolean(row.contactPhone),
      linkToken: row.teacherLinkToken,
      forms: [],
      overdue: false,
      outstanding: 0,
    };

    entry.forms.push({
      requestId: row.id,
      title: row.title,
      audienceKind: row.audienceKind,
      audienceLabel: row.audienceLabel,
      fieldKeys: row.fieldKeys,
      dueDate: row.dueDate,
      token: row.token,
      answered: row.studentsAnswered,
      rosterSize: row.rosterSize,
      overdue: row.dueDate < today,
    });
    groups.set(key, entry);
  }

  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      // Oldest deadline first: within one message, the thing she is latest on
      // should be the thing she reads first.
      forms: entry.forms.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      overdue: entry.forms.some((form) => form.overdue),
      outstanding: entry.forms.reduce(
        (sum, form) => sum + Math.max(0, form.rosterSize - form.answered),
        0,
      ),
    }))
    .sort((a, b) => {
      // Overdue teachers first — they are who someone has to chase today.
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      // Then whoever is holding up the most children.
      if (a.outstanding !== b.outstanding) return b.outstanding - a.outstanding;
      return a.teacherName.localeCompare(b.teacherName);
    });
}
