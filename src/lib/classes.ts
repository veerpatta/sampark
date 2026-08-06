/**
 * Class label conventions, and the two other things a roster is sorted and
 * displayed by.
 *
 * Open decision #3 in the plan is settled by the data, not by us. The VPPS Fee
 * Management App is the source of truth for class labels and it uses exactly the
 * nineteen below. Sampark must use them character for character, because
 * corrected data goes back to the fee app and the two systems join on the label.
 *
 * Whatever appears here must match `students.class_label` character for
 * character in the other direction too: that column is what request creation
 * filters the roster on, so a stray trailing space silently produces a request
 * with an empty roster and no error. Every path that accepts a class label runs
 * it through normaliseClassLabel first, then validates against CLASS_LABELS:
 * the importer, the teacher editor and the request builder.
 */

/**
 * The nineteen classes, in the order a timetable reads them.
 *
 * The ORDER OF THIS ARRAY IS THE SORT ORDER. Sorting nineteen known labels by a
 * fixed index is honest; a parser that infers order from the text is not — the
 * one that used to live here read a leading digit, which sent both "Class 6" and
 * "Nursery" to Infinity and then sorted them alphabetically.
 */
export const CLASS_LABELS = [
  "Nursery",
  "JKG",
  "SKG",
  "Class 1",
  "Class 2",
  "Class 3",
  "Class 4",
  "Class 5",
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
  "11 Arts",
  "11 Commerce",
  "11 Science",
  "12 Arts",
  "12 Commerce",
  "12 Science",
] as const;

export type ClassLabel = (typeof CLASS_LABELS)[number];

const CLASS_ORDER = new Map<string, number>(
  CLASS_LABELS.map((label, index) => [label, index]),
);

/** Collapse internal whitespace and trim. Case is left alone. */
export function normaliseClassLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Is this one of the nineteen? Case-sensitive, deliberately. */
export function isClassLabel(label: string): label is ClassLabel {
  return CLASS_ORDER.has(label);
}

/**
 * The message shown when a label is rejected. One sentence, and it lists what
 * would have been accepted — an import error that only says "invalid" sends
 * someone to read the source.
 */
export function unknownClassLabelMessage(label: string): string {
  return `Class "${label}" is not one of the ${CLASS_LABELS.length} classes the fee app uses (${CLASS_LABELS.join(", ")})`;
}

/** Parse the comma-separated class list used by the teacher editor. */
export function parseClassList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map(normaliseClassLabel)
        .filter((label) => label.length > 0),
    ),
  ];
}

/**
 * Sort class labels the way a human reads a timetable, by position in
 * CLASS_LABELS. Anything not in the list sorts last rather than being dropped —
 * a stray label is a problem to see, not to hide.
 */
export function compareClassLabels(a: string, b: string): number {
  const left = CLASS_ORDER.get(a) ?? Number.POSITIVE_INFINITY;
  const right = CLASS_ORDER.get(b) ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;
  return a.localeCompare(b);
}

/* --------------------------------------------------------------- students */

/**
 * Roster order.
 *
 * The real export has no roll numbers — the column does not exist and all 504
 * students carry null — so ordering by one produced an arbitrary sequence that
 * matched nothing on the teacher's paper register. Name order at least matches
 * how she reads a list.
 */
export function compareStudentNames(a: string, b: string): number {
  return titleCaseName(a).localeCompare(titleCaseName(b), "hi");
}

/**
 * Render an ALL CAPS name as title case.
 *
 * 483 of the 504 names are stored in capitals because that is how they were
 * typed into the fee app. A Hindi-first screen shouting ANSHUL KUMAWAT reads as
 * an error message, so this runs at RENDER time and never on write — the stored
 * value stays exactly what the fee app holds, and snapshots frozen before this
 * existed are fixed too.
 *
 * A name that already contains a lowercase letter is left completely alone. It
 * was typed deliberately and we have no business second-guessing it.
 */
export function titleCaseName(name: string): string {
  if (/[a-zऀ-ॿ]/.test(name)) return name;
  return name.replace(
    /[A-Za-z]+/g,
    (word) => word[0]! + word.slice(1).toLowerCase(),
  );
}
