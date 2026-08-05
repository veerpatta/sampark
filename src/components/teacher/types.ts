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
  rollNo: number | null;
  name: string;
  fatherName: string | null;
  values: Record<string, string | null>;
};

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
