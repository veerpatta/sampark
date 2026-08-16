import { isAnsweredFully } from "./answered";
import type { RequestBoardRow } from "./requests";

/**
 * How far each teacher has got, which is the question the office actually has.
 *
 * The boards answered a different one. /requests was one row per link and asked
 * "was this sent, is it closed"; /marks was keyed on the period and could not
 * roll up to a person; the dashboard's panel was per-teacher but DROPPED
 * finished work, because it was built to feed reminders. So there was nowhere
 * to see one teacher's whole load, and nowhere that a teacher who had finished
 * appeared at all.
 *
 * PURE, and no database import, for the same reason lib/reminders.ts and
 * lib/send-queue.ts are: the grouping rule is the part that can be subtly
 * wrong, and it should be testable without a connection. Everything it needs is
 * already on RequestBoardRow — no new query exists for this file.
 *
 * IT KEEPS FINISHED FORMS. That is the whole difference from
 * groupRemindersByTeacher, which drops them and is right to: you do not nudge
 * somebody about work she has done. A progress board that dropped them would
 * show a teacher who had finished everything as absent, which reads identically
 * to a teacher nobody asked.
 */

/** Marks and master data are different work and get chased differently. */
export type FormKind = "marks" | "details" | "mixed";

/** One link on one teacher's list, finished or not. */
export type ProgressForm = {
  requestId: string;
  title: string;
  audienceKind: string;
  audienceLabel: string;
  fieldKeys: string[];
  /** This one request's own link, for a teacher with no durable page. */
  token: string;
  kind: FormKind;
  dueDate: string;
  answered: number;
  rosterSize: number;
  changesPending: number;
  /**
   * Did the office ever hand this over?
   *
   * A link nobody sent is not a teacher who has not started, and on a screen
   * titled "how far has each teacher got" the difference is the difference
   * between a chase and an apology.
   */
  sent: boolean;
  overdue: boolean;
  done: boolean;
};

/** One kind of work, totalled across a teacher's links. */
export type Bucket = {
  links: number;
  linksDone: number;
  /** Children across those links — the denominator on screen. */
  students: number;
  answered: number;
  outstanding: number;
};

export type TeacherProgress = {
  /** `teacherId|phone` — stable, and safe to use as a React key. */
  key: string;
  teacherId: string;
  teacherName: string;
  phone: string;
  /** A contact_phone override sent this somewhere other than her saved number. */
  overridden: boolean;
  linkToken: string | null;
  /** Every open form she holds, in due-date order. Finished ones included. */
  forms: ProgressForm[];
  marks: Bucket;
  details: Bucket;
  mixed: Bucket;
  /** Children still unanswered for, across everything she holds. */
  outstanding: number;
  /** Past due AND unfinished — see the note in groupProgressByTeacher. */
  overdue: boolean;
  /** What she has sent that the office still owes her a decision on. */
  changesPending: number;
};

const emptyBucket = (): Bucket => ({
  links: 0,
  linksDone: 0,
  students: 0,
  answered: 0,
  outstanding: 0,
});

/**
 * Is this link a marks round, a data round, or both at once?
 *
 * Decided from the registry's `record_kind`, passed in as a set, and never from
 * the `fa_` prefix or from SUBJECTS — rule 11 says a collectable field is a row,
 * not a deployment, so a seventeenth subject added at Settings → Fields has to
 * classify correctly with nobody editing this file.
 *
 * MIXED IS A REAL STATE AND IS NOT SPLIT. Coverage is computed per student
 * across a request's WHOLE field set (see lib/answered.ts), so a link asking for
 * fa_maths and phone together cannot say how far the marks half has got — the
 * one number it has covers both. Nothing forbids building such a link at
 * /requests/new. Counting it into both buckets would double the denominator and
 * report work twice; picking one would hide the other. So it gets its own
 * bucket and its own word on screen, and splitting it properly stays an
 * explicit piece of future work rather than a silent guess.
 */
export function classifyForm(
  fieldKeys: string[],
  marksKeys: ReadonlySet<string>,
): FormKind {
  let marks = false;
  let details = false;
  for (const key of fieldKeys) {
    if (marksKeys.has(key)) marks = true;
    else details = true;
  }
  if (marks && details) return "mixed";
  return marks ? "marks" : "details";
}

/**
 * One entry per teacher, carrying everything she currently holds.
 *
 * KEYED BY ID AND NUMBER, NEVER BY NAME — the same rule and the same two
 * reasons as groupLinksByRecipient in lib/send-queue.ts. Two teachers can share
 * a name, and a request carrying a contact_phone override is deliberately going
 * somewhere else (she is on leave and her sister covers that section). Folding
 * an overridden request into her saved-number entry would put it in a message
 * sent to the wrong phone.
 *
 * `done` comes from isAnsweredFully, imported, so this file does not acquire a
 * second opinion about what "answered" means. That definition has been wrong in
 * more than one place before.
 */
export function groupProgressByTeacher(
  rows: RequestBoardRow[],
  marksKeys: ReadonlySet<string>,
  today: string,
): TeacherProgress[] {
  const groups = new Map<string, TeacherProgress>();

  for (const row of rows) {
    // Closed links are finished work nobody chases. Archived rows never reach
    // here — listRequests filters them unless explicitly asked for.
    if (row.status !== "open") continue;

    const key = `${row.teacherId}|${row.teacherPhone}`;
    const entry = groups.get(key) ?? {
      key,
      teacherId: row.teacherId,
      teacherName: row.teacher,
      phone: row.teacherPhone,
      overridden: Boolean(row.contactPhone),
      linkToken: row.teacherLinkToken,
      forms: [],
      marks: emptyBucket(),
      details: emptyBucket(),
      mixed: emptyBucket(),
      outstanding: 0,
      overdue: false,
      changesPending: 0,
    };

    const done = isAnsweredFully(row);
    entry.forms.push({
      requestId: row.id,
      title: row.title,
      audienceKind: row.audienceKind,
      audienceLabel: row.audienceLabel,
      fieldKeys: row.fieldKeys,
      token: row.token,
      kind: classifyForm(row.fieldKeys, marksKeys),
      dueDate: row.dueDate,
      answered: row.studentsAnswered,
      rosterSize: row.rosterSize,
      changesPending: row.changesPending,
      sent: row.sentAt !== null,
      // Past due only counts against her while there is still work in it. A
      // link she FINISHED last week is not something anybody is late on, and
      // letting it set the flag would sort her to the top of a chase list she
      // does not belong on.
      overdue: row.dueDate < today && !done,
      done,
    });
    groups.set(key, entry);
  }

  return [...groups.values()]
    .map((entry) => {
      const forms = entry.forms
        .slice()
        // Oldest deadline first: the thing she is latest on reads first.
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      const buckets: Record<FormKind, Bucket> = {
        marks: emptyBucket(),
        details: emptyBucket(),
        mixed: emptyBucket(),
      };
      for (const form of forms) {
        const bucket = buckets[form.kind];
        bucket.links += 1;
        if (form.done) bucket.linksDone += 1;
        bucket.students += form.rosterSize;
        bucket.answered += form.answered;
        bucket.outstanding += Math.max(0, form.rosterSize - form.answered);
      }

      return {
        ...entry,
        forms,
        marks: buckets.marks,
        details: buckets.details,
        mixed: buckets.mixed,
        outstanding:
          buckets.marks.outstanding +
          buckets.details.outstanding +
          buckets.mixed.outstanding,
        overdue: forms.some((form) => form.overdue),
        changesPending: forms.reduce((sum, form) => sum + form.changesPending, 0),
      };
    })
    .sort((a, b) => {
      // Overdue first — they are who someone has to chase today.
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      // Then whoever is holding up the most children.
      if (a.outstanding !== b.outstanding) return b.outstanding - a.outstanding;
      return a.teacherName.localeCompare(b.teacherName);
    });
}
