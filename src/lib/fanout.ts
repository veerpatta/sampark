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

export type FanOutGroup = {
  scope: Scope;
  studentIds: string[];
  choice: TeacherChoice;
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
  | "route_incharge";

const KIND_BY_MODE: Record<RecipientMode, ScopeKind> = {
  class_teacher: "class",
  house_incharge: "house",
  route_incharge: "route",
};

export function isRecipientMode(value: string): value is RecipientMode {
  return value in KIND_BY_MODE;
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
  mode: RecipientMode,
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
