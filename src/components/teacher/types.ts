/**
 * Shapes shared between the teacher surface's server render and its client
 * components. Deliberately plain — everything here crosses the server/client
 * boundary and has to survive serialisation.
 */

export type TeacherField = {
  key: string;
  labelEn: string;
  labelHi: string;
  mode: string;
  inputType: string;
  exactLen: number | null;
  pattern: string | null;
  maxValue: string | null;
  options: unknown;
  targetColumn: string | null;
};

export type TeacherRosterRow = {
  studentId: string;
  /**
   * The only stable identifier that exists. There are no roll numbers in the
   * real data and no parent names, so this is what she cross-checks against a
   * paper register.
   */
  srNo: string | null;
  name: string;
  /** Present for about half the school, and real context when it is. */
  route: string | null;
  /** One of the four houses. Rendered as a coloured chip. */
  house: string | null;
  /** Which class — a house or route link carries children from several. */
  classLabel: string | null;
  fatherName: string | null;
  values: Record<string, string | null>;
  /**
   * A number already on record for a sibling, when this child has none.
   * Offered as one tap and never prefilled — see snapshots.ts, where it is
   * worked out and frozen.
   */
  siblingPhone: { name: string; phone: string } | null;
};

/**
 * Does the school hold anything for this student, for these fields?
 *
 * This one predicate decides everything about how the row is presented: a blank
 * row opens its inputs directly and goes at the top of the screen, a known row
 * shows what we hold and can be confirmed in bulk. A collect-mode field is
 * always blank by definition — we hold nothing for it anywhere.
 */
export function isBlankRow(
  student: TeacherRosterRow,
  fields: TeacherField[],
): boolean {
  return fields.some(
    (field) =>
      field.mode === "collect" ||
      !student.values[field.key],
  );
}

/**
 * Where a student's row has got to.
 *
 *   todo      — untouched. This is what the progress rail counts down.
 *   editing   — inputs are open and she is typing. NOT done yet.
 *   confirmed — she tapped सही है.
 *   edited    — she corrected something and tapped हो गया.
 *   absent    — she tapped नहीं है.
 *
 * `editing` is deliberately not counted as done: a half-typed phone number is
 * not an answer, and a progress bar that says otherwise is lying to her.
 */
export type RowStatus = "todo" | "editing" | "confirmed" | "edited" | "absent";

export const ANSWERED: RowStatus[] = ["confirmed", "edited", "absent"];

export type RowState = {
  status: RowStatus;
  /** Only the fields she actually changed. An absent key means unchanged. */
  values: Record<string, string>;
};
