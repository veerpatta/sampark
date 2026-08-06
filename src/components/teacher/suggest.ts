import type { RowState, TeacherField, TeacherRosterRow } from "./types";

/**
 * "पिछले जैसा" — offer the value she just used for the row above.
 *
 * The biggest keystroke saving actually present in this school's data. A bus
 * route is a 29-option select, which on Android is a full-screen wheel per
 * child, and a village route is shared by a whole cluster of children who sort
 * next to each other by name. Same for village. One tap instead of a wheel,
 * twelve times in a row.
 *
 * NEVER FOR A PHONE NUMBER. Two unrelated children sharing a number is exactly
 * the fat-finger error the office cannot detect afterwards — every number looks
 * equally plausible in a spreadsheet. Siblings genuinely do share one, but that
 * case is answered by the sibling suggestion frozen into the snapshot, which
 * knows they are siblings. A blanket "same as the last child" does not.
 */

/** Fields worth offering a carry-down for: a fixed vocabulary, typed often. */
export function canCarryDown(field: TeacherField): boolean {
  if (field.inputType === "tel") return false;
  if (field.exactLen) return false;
  if (field.inputType === "select") return true;
  // Free text only where the vocabulary is small and repeats — village names.
  return field.inputType === "text" && field.key === "village";
}

/**
 * The nearest answer above this row for this field, if there is one.
 *
 * Walks up from the row in question rather than taking the most common value:
 * she is working down a list sorted by name, so the row above is the one whose
 * route is most likely to be shared, and a global mode would keep offering the
 * biggest route long after she had moved past it.
 */
export function suggestForRow(
  field: TeacherField,
  order: TeacherRosterRow[],
  index: number,
  rows: Record<string, RowState>,
): string | null {
  if (!canCarryDown(field)) return null;

  for (let i = index - 1; i >= 0; i -= 1) {
    const previous = order[i];
    if (!previous) continue;

    // What she typed wins over what was already on record: if she has just
    // corrected three children onto a new route, that is the live answer.
    const typed = rows[previous.studentId]?.values[field.key];
    if (typed) return typed;

    const stored = previous.values[field.key];
    if (stored) return stored;
  }

  return null;
}
