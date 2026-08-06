/**
 * Which teacher owns this class, house or bus route.
 *
 * The rule that used to live in teachers.ts, generalised. Its shape is the whole
 * point and has not changed: creating a request and then hunting for who owns
 * the group is work the app already has the answer to, but answering it WRONGLY
 * is worse than not answering — a link sent to the wrong teacher is a group that
 * never gets collected and nobody notices until the due date.
 *
 * So there are exactly three outcomes and none of them is a guess. Pure, no
 * database, so the quick send, the request builder and the bulk fan-out all use
 * one rule and it can be tested without one.
 *
 * Matching is exact. Several bus routes differ only by a parenthesised suffix
 * ("Amet Railway Station (Inside)" against "(On Road)"), so a prefix or
 * substring match here would silently hand one route's children to another
 * route's in-charge.
 */

export type ScopeKind = "class" | "house" | "route";

export type Scope = { kind: ScopeKind; value: string };

export type TeacherLike = {
  id: string;
  name: string;
  classes: string[];
  /** Optional so the single-class callers can keep passing what they always did. */
  houses?: string[];
  routes?: string[];
};

export type TeacherChoice =
  /** Exactly one teacher owns it. Selected silently — no banner, no ceremony. */
  | { kind: "one"; teacherId: string; owners: TeacherLike[] }
  /** More than one. Nothing is selected and she is told why. */
  | { kind: "many"; owners: TeacherLike[]; message: string }
  /** Nobody owns it. Nothing is selected and the full list is offered. */
  | { kind: "none"; owners: []; message: string };

function ownedBy(teacher: TeacherLike, scope: Scope): boolean {
  const list =
    scope.kind === "class"
      ? teacher.classes
      : scope.kind === "house"
        ? teacher.houses
        : teacher.routes;
  return (list ?? []).includes(scope.value);
}

/** Everyone assigned to this scope. Empty when nothing is chosen yet. */
export function ownersFor(
  teachers: TeacherLike[],
  scope: Scope,
): TeacherLike[] {
  if (!scope.value) return [];
  return teachers.filter((teacher) => ownedBy(teacher, scope));
}

/** How the scope reads in a sentence: "Class 8", "Rana Pratap house". */
export function describeScope(scope: Scope): string {
  if (scope.kind === "house") return `${scope.value} house`;
  if (scope.kind === "route") return `the ${scope.value} route`;
  return scope.value;
}

/** Where an owner is assigned, for the "fix it in Settings" pointer. */
function settingsHint(kind: ScopeKind): string {
  return kind === "class"
    ? "Settings → Teachers"
    : `Settings → Teachers, under ${kind === "house" ? "houses" : "routes"}`;
}

export function chooseTeacherForScope(
  teachers: TeacherLike[],
  scope: Scope,
): TeacherChoice {
  const owners = ownersFor(teachers, scope);

  if (owners.length === 1) {
    return { kind: "one", teacherId: owners[0]!.id, owners };
  }

  if (owners.length > 1) {
    return {
      kind: "many",
      owners,
      message: `${owners.length} teachers are assigned to ${describeScope(scope)} — choose one.`,
    };
  }

  return {
    kind: "none",
    owners: [],
    message: scope.value
      ? `No teacher is assigned to ${describeScope(scope)}. Pick anyone, or fix it in ${settingsHint(scope.kind)}.`
      : "Pick a class first.",
  };
}

/** Owners first, then everyone else — both in the order they were given. */
export function partitionByScope(
  teachers: TeacherLike[],
  scope: Scope,
): { owners: TeacherLike[]; others: TeacherLike[] } {
  const owners: TeacherLike[] = [];
  const others: TeacherLike[] = [];
  for (const teacher of teachers) {
    (scope.value && ownedBy(teacher, scope) ? owners : others).push(teacher);
  }
  return { owners, others };
}
