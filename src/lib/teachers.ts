/**
 * Which teacher owns this class.
 *
 * Creating a request for Class 8 and then hunting for who teaches Class 8 is
 * work the app already has the answer to. But answering it wrongly is worse
 * than not answering: a link sent to the wrong teacher is a class that never
 * gets collected and nobody notices until the due date.
 *
 * So there are exactly three outcomes and none of them is a guess. Pure, no
 * database, so both the request builder and the dashboard's quick send use the
 * same rule and it can be tested without one.
 */

export type TeacherLike = {
  id: string;
  name: string;
  classes: string[];
};

export type TeacherChoice =
  /** Exactly one teacher owns it. Selected silently — no banner, no ceremony. */
  | { kind: "one"; teacherId: string; owners: TeacherLike[] }
  /** More than one. Nothing is selected and she is told why. */
  | { kind: "many"; owners: TeacherLike[]; message: string }
  /** Nobody owns it. Nothing is selected and the full list is offered. */
  | { kind: "none"; owners: []; message: string };

export function chooseTeacherForClass(
  teachers: TeacherLike[],
  classLabel: string,
): TeacherChoice {
  const owners = classLabel
    ? teachers.filter((teacher) => teacher.classes.includes(classLabel))
    : [];

  if (owners.length === 1) {
    return { kind: "one", teacherId: owners[0]!.id, owners };
  }

  if (owners.length > 1) {
    return {
      kind: "many",
      owners,
      message: `${owners.length} teachers are assigned to ${classLabel} — choose one.`,
    };
  }

  return {
    kind: "none",
    owners: [],
    message: classLabel
      ? `No teacher is assigned to ${classLabel}. Pick anyone, or fix it in Settings → Teachers.`
      : "Pick a class first.",
  };
}

/** Owners first, then everyone else — both alphabetical within their group. */
export function partitionByClass(
  teachers: TeacherLike[],
  classLabel: string,
): { owners: TeacherLike[]; others: TeacherLike[] } {
  const owners: TeacherLike[] = [];
  const others: TeacherLike[] = [];
  for (const teacher of teachers) {
    (classLabel && teacher.classes.includes(classLabel) ? owners : others).push(
      teacher,
    );
  }
  return { owners, others };
}
