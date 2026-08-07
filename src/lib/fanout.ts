import {
  chooseTeacherForScope,
  describeScope,
  type Scope,
  type ScopeKind,
  type TeacherChoice,
  type TeacherLike,
} from "./ownership";
import { compareClassLabels } from "./classes";
import { hasPhone } from "./phone";
import {
  chooseTeacherForSubject,
  type SubjectAssignment,
} from "./subjects";

/**
 * Turning one audience into N links.
 *
 * A request is one token, one frozen roster, one recipient. "Ask every class for
 * phone numbers" is therefore nineteen requests, and the question this module
 * answers is which nineteen, to whom, and — the part that matters most — who
 * gets left out.
 *
 * WHO GETS LEFT OUT IS FIRST CLASS. House is recorded for about a third of the
 * school and bus route for about half. Grouping a house-wise send by house
 * silently drops every child with no house on record, and that is the single
 * worst thing this feature can do: the office believes it asked about everyone,
 * the missing children are exactly the ones whose data is thinnest, and nobody
 * finds out. So `unassigned` is returned alongside the groups, never derived
 * from a discrepancy between two totals, and the preview screen states it in
 * words before anything is created.
 *
 * Pure, no database. The recipient rule is chooseTeacherForScope, which is
 * allowed to answer "more than one" and "nobody" rather than guess.
 */

/** Only what the plan needs. Keeps this callable from a test with a literal. */
export type PlannableStudent = {
  id: string;
  name: string;
  classLabel: string;
  house: string | null;
  busRoute: string | null;
};

export type Recipient = TeacherLike & { phone: string };

/**
 * A group addressed by subject rather than by a column on the student row.
 *
 * `value` is what lands in requests.audience_label, and it carries the TEACHER
 * as well as the subject because seven different people teach Maths — the
 * unique index on (batch, kind, label) would collide seven ways otherwise.
 *
 * `classLabels` is a list because one link legitimately spans classes: Prakash
 * teaches Economics to four of them and gets one screen for all four, exactly
 * as a house link already spans classes today.
 */
export type SubjectScope = {
  kind: "subject";
  value: string;
  subjectKey: string;
  subjectEn: string;
  /** The one fa_* field this link asks for. */
  fieldKey: string;
  classLabels: string[];
};

/** What a group is addressed by. Subject is not a ScopeKind — see ownership.ts. */
export type GroupScope = Scope | SubjectScope;

export type FanOutGroup = {
  scope: GroupScope;
  studentIds: string[];
  choice: TeacherChoice;
  /**
   * The fields THIS group asks for, when they are narrower than the batch's.
   *
   * Undefined everywhere except subject mode, where it is the single fa_* key
   * for that subject. A batch collecting four subjects still stores all four on
   * request_batches — resolveFields, resolvePeriod and loadPriorRecords all
   * need the union — but no teacher should be shown a subject she does not
   * teach. See runGroups in lib/batches.ts.
   */
  fieldKeys?: string[];
};

/** A group that cannot be sent as it stands, and the one reason why. */
export type BlockedGroup = FanOutGroup & {
  reason: "many-owners" | "no-owner" | "no-phone";
  message: string;
};

export type ReadyGroup = FanOutGroup & {
  teacherId: string;
  teacherName: string;
};

export type UnassignedStudent = {
  studentId: string;
  name: string;
  classLabel: string;
  reason: "no house on record" | "no bus route on record";
};

export type FanOutPlan = {
  ready: ReadyGroup[];
  blocked: BlockedGroup[];
  unassigned: UnassignedStudent[];
  totals: {
    /** Links that would be created right now. */
    links: number;
    /** Children those links would cover. */
    students: number;
    /** Children in the audience that no link would reach. */
    skipped: number;
  };
};

/**
 * Who the links go to, and therefore how the audience is cut into groups.
 *
 * One value rather than a mode plus a separate "group by", because a batch is
 * resumed days later from its stored row: two columns that must agree is a way
 * for them to disagree.
 */
export type RecipientMode =
  | "class_teacher"
  | "house_incharge"
  | "route_incharge"
  | "subject_teacher";

/**
 * The three modes that bucket by a column on the student row.
 *
 * subject_teacher is deliberately absent: it does not bucket students at all,
 * it starts from the assignment table and works out which children each
 * (teacher, subject) covers. planFanOut cannot express that, which is why it
 * has its own planner rather than a fourth branch.
 */
const KIND_BY_MODE: Record<
  Exclude<RecipientMode, "subject_teacher">,
  ScopeKind
> = {
  class_teacher: "class",
  house_incharge: "house",
  route_incharge: "route",
};

export function isRecipientMode(value: string): value is RecipientMode {
  return value in KIND_BY_MODE || value === "subject_teacher";
}

/** Modes where every child belongs to exactly one group. */
export function isStudentBucketed(
  mode: RecipientMode,
): mode is Exclude<RecipientMode, "subject_teacher"> {
  return mode !== "subject_teacher";
}

/**
 * Cut the audience into groups and find each one's recipient.
 *
 * In `class_teacher` mode a group is a class, whatever the audience filtered on
 * — "Rana Pratap house across classes 6 to 8" becomes three links, each to a
 * class teacher, each carrying only her own house children. Nobody is dropped,
 * because every student has a class.
 *
 * In the in-charge modes a group is the house or the route itself, and children
 * without one cannot be placed. That is what `unassigned` is for.
 */
export function planFanOut(
  students: PlannableStudent[],
  teachers: Recipient[],
  mode: Exclude<RecipientMode, "subject_teacher">,
): FanOutPlan {
  const kind = KIND_BY_MODE[mode];

  const buckets = new Map<string, string[]>();
  const unassigned: UnassignedStudent[] = [];

  for (const student of students) {
    const value =
      kind === "class"
        ? student.classLabel
        : kind === "house"
          ? student.house
          : student.busRoute;

    if (!value) {
      unassigned.push({
        studentId: student.id,
        name: student.name,
        classLabel: student.classLabel,
        reason:
          kind === "house" ? "no house on record" : "no bus route on record",
      });
      continue;
    }

    const bucket = buckets.get(value) ?? [];
    bucket.push(student.id);
    buckets.set(value, bucket);
  }

  const ready: ReadyGroup[] = [];
  const blocked: BlockedGroup[] = [];

  for (const value of sortValues([...buckets.keys()], kind)) {
    const scope: Scope = { kind, value };
    const studentIds = buckets.get(value)!;
    const choice = chooseTeacherForScope(teachers, scope);
    const group: FanOutGroup = { scope, studentIds, choice };

    if (choice.kind === "many") {
      blocked.push({ ...group, reason: "many-owners", message: choice.message });
      continue;
    }
    if (choice.kind === "none") {
      blocked.push({ ...group, reason: "no-owner", message: choice.message });
      continue;
    }

    const teacher = teachers.find((row) => row.id === choice.teacherId)!;

    // A link nobody can be sent is a roster frozen for nothing. Caught here so
    // the preview can offer a number to type, rather than at insert time.
    if (!hasPhone(teacher.phone)) {
      blocked.push({
        ...group,
        reason: "no-phone",
        message: `No number is saved for ${teacher.name}. Type one for ${describeScope(scope)}.`,
      });
      continue;
    }

    ready.push({
      ...group,
      teacherId: teacher.id,
      teacherName: teacher.name,
    });
  }

  const covered = ready.reduce((sum, group) => sum + group.studentIds.length, 0);
  const blockedCount = blocked.reduce(
    (sum, group) => sum + group.studentIds.length,
    0,
  );

  return {
    ready,
    blocked,
    unassigned,
    totals: {
      links: ready.length,
      students: covered,
      skipped: blockedCount + unassigned.length,
    },
  };
}

/** Classes read like a timetable; houses and routes are alphabetical. */
function sortValues(values: string[], kind: ScopeKind): string[] {
  return kind === "class"
    ? values.sort(compareClassLabels)
    : values.sort((a, b) => a.localeCompare(b));
}

/** A subject the office has picked for this round. */
export type SubjectPick = {
  key: string;
  en: string;
  fieldKey: string;
};

/**
 * One link per (teacher, subject), and each asks about that subject alone.
 *
 * A DIFFERENT SHAPE FROM planFanOut, which is why it is a different function.
 * That one reads a column off each student and buckets by it; every child lands
 * in exactly one bucket. Here the grouping lives in teacher_subjects, and a
 * child in Class 8 taught five subjects belongs to five groups at once. The
 * accounting invariant that holds over there — every child counted exactly once
 * across ready, blocked and unassigned — cannot hold here, and pretending
 * otherwise would mean either dropping a subject or double-counting a child.
 * `totals.students` therefore counts STUDENT-LINKS in this mode.
 *
 * Resolution is per (subject, class), because that is the grain at which the
 * school actually decides. The resolved classes are then merged by teacher, so
 * Prakash's four Economics classes are one screen and not four messages.
 *
 * A class in the audience that nobody is down to teach a picked subject to puts
 * its children in `unassigned`, loudly. The office must never read "5 links,
 * 200 children" as success while Class 3's Hindi was never asked for.
 */
export function planSubjectFanOut(
  students: PlannableStudent[],
  teachers: Recipient[],
  assignments: SubjectAssignment[],
  subjects: SubjectPick[],
): FanOutPlan {
  const byClass = new Map<string, PlannableStudent[]>();
  for (const student of students) {
    const bucket = byClass.get(student.classLabel) ?? [];
    bucket.push(student);
    byClass.set(student.classLabel, bucket);
  }
  const classLabels = [...byClass.keys()].sort(compareClassLabels);

  const ready: ReadyGroup[] = [];
  const blocked: BlockedGroup[] = [];

  for (const subject of subjects) {
    // Merged per teacher, so one teacher gets one link for this subject however
    // many of her classes are in scope.
    const merged = new Map<
      string,
      { teacher: Recipient; choice: TeacherChoice; classLabels: string[]; studentIds: string[] }
    >();

    for (const classLabel of classLabels) {
      const roster = byClass.get(classLabel)!;
      const choice = chooseTeacherForSubject(
        assignments,
        teachers,
        subject.key,
        classLabel,
      );

      // Blocked groups stay PER CLASS rather than merged. There is no teacher to
      // merge them under, and the office's override picks one person for one
      // class — collapsing "nobody teaches Hindi to Class 3 or Class 4" into a
      // single row would make that one choice silently cover both.
      if (choice.kind !== "one") {
        blocked.push({
          scope: subjectScope(subject, `${subject.en} — ${classLabel}`, [classLabel]),
          studentIds: roster.map((s) => s.id),
          choice,
          fieldKeys: [subject.fieldKey],
          reason: choice.kind === "many" ? "many-owners" : "no-owner",
          message: choice.message,
        });
        continue;
      }

      const teacher = teachers.find((row) => row.id === choice.teacherId)!;
      const entry = merged.get(teacher.id) ?? {
        teacher,
        choice,
        classLabels: [],
        studentIds: [],
      };
      entry.classLabels.push(classLabel);
      entry.studentIds.push(...roster.map((s) => s.id));
      merged.set(teacher.id, entry);
    }

    for (const entry of [...merged.values()].sort((a, b) =>
      a.teacher.name.localeCompare(b.teacher.name),
    )) {
      const scope = subjectScope(
        subject,
        `${subject.en} — ${entry.teacher.name}`,
        entry.classLabels,
      );
      const group: FanOutGroup = {
        scope,
        studentIds: entry.studentIds,
        choice: entry.choice,
        fieldKeys: [subject.fieldKey],
      };

      if (!hasPhone(entry.teacher.phone)) {
        blocked.push({
          ...group,
          reason: "no-phone",
          message: `No number is saved for ${entry.teacher.name}. Type one for ${subject.en}.`,
        });
        continue;
      }

      ready.push({
        ...group,
        teacherId: entry.teacher.id,
        teacherName: entry.teacher.name,
      });
    }
  }

  const covered = ready.reduce((sum, group) => sum + group.studentIds.length, 0);
  const blockedCount = blocked.reduce(
    (sum, group) => sum + group.studentIds.length,
    0,
  );

  return {
    ready,
    blocked,
    // Empty, always, and that is not an oversight. `unassigned` means a child
    // the grouping COULD NOT PLACE — no house on record, no route. Every child
    // has a class, so a subject with nobody down to teach it is a group the
    // office can fix by naming someone, which is exactly what `blocked` is.
    // Same treatment a house with no in-charge already gets.
    unassigned: [],
    totals: {
      links: ready.length,
      // Student-LINKS, not children: a child taught four of the picked subjects
      // is reached four times, and calling that "4 children" would be a lie in
      // the other direction.
      students: covered,
      skipped: blockedCount,
    },
  };
}

function subjectScope(
  subject: SubjectPick,
  value: string,
  classLabels: string[],
): SubjectScope {
  return {
    kind: "subject",
    value,
    subjectKey: subject.key,
    subjectEn: subject.en,
    fieldKey: subject.fieldKey,
    classLabels,
  };
}
