import { isClassLabel, normaliseClassLabel } from "./classes";
import { editDistance } from "./name-match";
import {
  isNonAcademic,
  subjectFromTimetable,
  type SubjectAssignment,
} from "./subjects";

/**
 * Turning the school's timetable into subject assignments.
 *
 * The timetable lives in a separate repo as a day x period x class grid. It is
 * the only place that knows Jainendra teaches Hindi to ten classes, so it is
 * worth importing — but it was written for a different purpose and two things
 * about it do not line up with this database:
 *
 *   - teachers are BARE FIRST NAMES. "Prateek", not "Pratik Jain". There are no
 *     ids and no surnames, so the join is a name match and name matches are
 *     guesses.
 *   - classes 11 and 12 are spelled "Class 11 Science" there and "11 Science"
 *     here.
 *
 * So this module PLANS and does not write. Everything it is confident about is
 * separated from everything it is only suggesting, and the unmatched are named
 * rather than dropped — the same discipline as the fan-out's `unassigned`. A
 * timetable importer that silently skipped a teacher would produce a marks
 * round missing one person's subjects, and nothing on any screen would say so.
 *
 * Pure: no database, no filesystem. The script hands it parsed data.
 */

/** One cell of the grid, as the timetable repo's own parser produces it. */
export type TimetableCell = {
  subject?: string;
  teachers?: string[];
  free?: boolean;
};

/** `timetable[day][className][periodIndex]`. */
export type TimetableGrid = Record<
  string,
  Record<string, (TimetableCell | null | undefined)[]>
>;

export type TeacherRow = { id: string; name: string };

export type SuggestedAssignment = SubjectAssignment & {
  /** The bare name in the timetable, so the office can see what was matched. */
  timetableName: string;
  teacherName: string;
  /** How close the two names were. 0 is an exact token match. */
  distance: number;
};

export type UnmatchedTeacher = {
  timetableName: string;
  /** What they teach, so the office can tell a real gap from a Sports-only name. */
  subjects: string[];
  classLabels: string[];
};

export type ImportPlan = {
  /** Safe to write: the timetable name matched a teacher token exactly. */
  confirmed: SuggestedAssignment[];
  /** A near miss. Must be confirmed by a person before it is written. */
  suggested: SuggestedAssignment[];
  /** Named, never dropped. */
  unmatchedTeachers: UnmatchedTeacher[];
  /** Class labels in the timetable that are not one of our nineteen. */
  unknownClasses: string[];
  /** Subject names we do not collect marks for and did not silently ignore. */
  skippedSubjects: string[];
};

/**
 * The timetable's class spelling, in ours.
 *
 * Classes 1-10 already agree. Only the senior ones carry a redundant "Class "
 * prefix there, and only those are rewritten — a blanket strip would turn
 * "Class 8" into "8", which is not a label this app knows.
 */
export function classLabelFromTimetable(raw: string): string | null {
  const cleaned = normaliseClassLabel(raw);
  if (isClassLabel(cleaned)) return cleaned;

  const withoutPrefix = cleaned.replace(/^Class\s+/i, "");
  return isClassLabel(withoutPrefix) ? withoutPrefix : null;
}

/**
 * Names the office has already decided about.
 *
 * The timetable spells three of our teachers differently, and a fuzzy match
 * only ever produces a SUGGESTION — correctly, because a name match is a
 * guess about two people. These three are not guesses any more: each was
 * checked against the day-wise timetable PDF and against the staff list, and
 * recording the answer here means a re-import six months from now does not ask
 * the same question again and risk a different answer.
 *
 * Keyed by the timetable's spelling, valued by ours. Anything not listed still
 * goes through the fuzzy path and still needs a person.
 */
const KNOWN_ALIASES: Record<string, string> = {
  pradhyuman: "Pradhuman Singh Ashiya",
  prateek: "Pratik Jain",
  nathulal: "Nathu Lal Khatik",
};

/**
 * Candidate keys a timetable first name could be hiding in a full name.
 *
 * BOTH forms are needed, and the second is not optional:
 *
 *   Pradhyuman -> "Pradhuman Singh Ashiya"  first token, distance 1  ✓
 *   Prateek    -> "Pratik Jain"             first token, distance 2  ✓
 *   Nathulal   -> "Nathu Lal Khatik"        first token, distance 3  ✗
 *                                           first two joined, 0      ✓
 *
 * Without the joined form the Class 9/10 Maths and Commerce Accountancy teacher
 * falls into "no such teacher" and her subjects quietly never get sent.
 */
function candidateKeys(fullName: string): string[] {
  const parts = fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return [];
  const keys = [parts[0]!];
  if (parts.length > 1) keys.push(parts[0]! + parts[1]!);
  return keys;
}

const MAX_DISTANCE = 2;

type Match = { teacher: TeacherRow; distance: number } | null;

function matchTeacher(timetableName: string, teachers: TeacherRow[]): Match {
  const needle = timetableName.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!needle) return null;

  // A settled alias is an exact match — distance 0 — so it lands in `confirmed`
  // and imports without --include-suggested. If the named teacher has since
  // left the roster it falls through to the fuzzy path rather than resolving to
  // nobody silently.
  const alias = KNOWN_ALIASES[needle];
  if (alias) {
    const known = teachers.find((teacher) => teacher.name === alias);
    if (known) return { teacher: known, distance: 0 };
  }

  let best: Match = null;
  for (const teacher of teachers) {
    for (const key of candidateKeys(teacher.name)) {
      const distance = editDistance(needle, key);
      if (distance > MAX_DISTANCE) continue;
      if (!best || distance < best.distance) best = { teacher, distance };
    }
  }
  return best;
}

/**
 * Read the grid into assignments.
 *
 * A (teacher, subject, class) triple is recorded once however many periods it
 * appears in — the timetable says it thirty times a week and the answer is the
 * same each time.
 */
export function planTimetableImport(
  grid: TimetableGrid,
  teachers: TeacherRow[],
): ImportPlan {
  const confirmed = new Map<string, SuggestedAssignment>();
  const suggested = new Map<string, SuggestedAssignment>();
  const unmatched = new Map<string, UnmatchedTeacher>();
  const unknownClasses = new Set<string>();
  const skippedSubjects = new Set<string>();

  for (const day of Object.keys(grid)) {
    for (const rawClass of Object.keys(grid[day] ?? {})) {
      const classLabel = classLabelFromTimetable(rawClass);
      if (!classLabel) {
        unknownClasses.add(normaliseClassLabel(rawClass));
        continue;
      }

      for (const cell of grid[day]![rawClass] ?? []) {
        if (!cell || cell.free || !cell.subject) continue;
        if (isNonAcademic(cell.subject)) continue;

        const subject = subjectFromTimetable(cell.subject);
        if (!subject) {
          // Not in SUBJECTS and not in NON_ACADEMIC — a spelling we have never
          // seen. Reported, because the alternative is a subject nobody can
          // collect marks for and no message anywhere.
          skippedSubjects.add(cell.subject.trim());
          continue;
        }

        for (const timetableName of cell.teachers ?? []) {
          const name = timetableName.trim();
          if (!name) continue;

          const match = matchTeacher(name, teachers);
          if (!match) {
            const entry = unmatched.get(name) ?? {
              timetableName: name,
              subjects: [],
              classLabels: [],
            };
            if (!entry.subjects.includes(subject.en)) entry.subjects.push(subject.en);
            if (!entry.classLabels.includes(classLabel)) {
              entry.classLabels.push(classLabel);
            }
            unmatched.set(name, entry);
            continue;
          }

          const assignment: SuggestedAssignment = {
            teacherId: match.teacher.id,
            subjectKey: subject.key,
            classLabel,
            timetableName: name,
            teacherName: match.teacher.name,
            distance: match.distance,
          };
          const key = `${assignment.teacherId}|${assignment.subjectKey}|${classLabel}`;
          (match.distance === 0 ? confirmed : suggested).set(key, assignment);
        }
      }
    }
  }

  const bySort = (a: SuggestedAssignment, b: SuggestedAssignment) =>
    a.teacherName.localeCompare(b.teacherName) ||
    a.subjectKey.localeCompare(b.subjectKey) ||
    a.classLabel.localeCompare(b.classLabel);

  return {
    confirmed: [...confirmed.values()].sort(bySort),
    suggested: [...suggested.values()].sort(bySort),
    unmatchedTeachers: [...unmatched.values()].sort((a, b) =>
      a.timetableName.localeCompare(b.timetableName),
    ),
    unknownClasses: [...unknownClasses].sort(),
    skippedSubjects: [...skippedSubjects].sort(),
  };
}
