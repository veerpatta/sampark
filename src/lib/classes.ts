/**
 * Class label conventions.
 *
 * Open decision #3 in the plan, settled: labels are "class number, then a short
 * stream suffix where one is needed" — `6`, `10 A`, `12 Sci`. Whatever appears
 * here must match `students.class_label` character for character, because that
 * column is what request creation filters the roster on. A stray trailing space
 * silently produces an empty roster, so every path that accepts a class label
 * runs it through normaliseClassLabel first: the importer, the teacher editor
 * and the request builder.
 */

/** Collapse internal whitespace and trim. Case is left alone — '12 Sci' reads better than '12 sci'. */
export function normaliseClassLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
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
 * Sort class labels the way a human reads a timetable: numerically by class,
 * then alphabetically by whatever follows. Plain string sort puts 10 before 6.
 */
export function compareClassLabels(a: string, b: string): number {
  const parse = (label: string) => {
    const match = /^(\d+)\s*(.*)$/.exec(label);
    return match
      ? { number: Number(match[1]), rest: match[2]! }
      : { number: Number.POSITIVE_INFINITY, rest: label };
  };
  const left = parse(a);
  const right = parse(b);
  if (left.number !== right.number) return left.number - right.number;
  return left.rest.localeCompare(right.rest);
}
