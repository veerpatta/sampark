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
  /**
   * What the school ALREADY HAS from her for this child, on this request.
   *
   * `values` above is the frozen snapshot — what we held when the link was
   * sent. This is what she has since sent back, read off the submissions table
   * by answersForRequest. The two are deliberately separate: the snapshot is
   * what the server diffs against and must never move, and this is what lets a
   * reopened link show her where she stopped.
   */
  answered: Record<string, string | null>;
  /** She has already said this child is not in her class. */
  notPresent: boolean;
};

/**
 * Everything known about this child, frozen and answered together.
 *
 * The one merge, in one place. A photograph she took an hour ago is as good an
 * answer as one the office had on file in January, and every question the
 * screen asks — is this row blank, is it finished, what is still missing —
 * has to treat them the same or the row comes back empty on the next reload.
 */
export function knownValues(
  student: Pick<TeacherRosterRow, "values" | "answered">,
): Record<string, string | null> {
  return { ...student.values, ...student.answered };
}

/**
 * Which of these fields this student must actually answer.
 *
 * A verify-mode field the school already holds a value for is NOT required:
 * leaving it alone means "unchanged, still right", and that is a real answer.
 * A field we hold nothing for — and every collect-mode field, where we hold
 * nothing anywhere by definition — is a hole, and untouched there is a gap, not
 * a confirmation. This is the one list that says which is which, and getting it
 * wrong is how a card with one of two boxes filled used to call itself finished.
 *
 * Frozen values, not live ones: student.values is the snapshot she was sent,
 * which is the same snapshot the server compares against in lib/submissions.ts.
 * The two halves agree by construction rather than by anyone remembering to
 * keep them in step.
 */
export function requiredKeys(
  student: Pick<TeacherRosterRow, "values">,
  fields: TeacherField[],
): string[] {
  return fields
    .filter((field) => field.mode === "collect" || !student.values[field.key])
    .map((field) => field.key);
}

/**
 * Does the school hold anything for this student, for these fields?
 *
 * This one predicate decides everything about how the row is presented: a blank
 * row opens its inputs directly and goes at the top of the screen, a known row
 * shows what we hold and can be confirmed in bulk.
 *
 * A wrapper over requiredKeys rather than its own copy of the rule. The screen
 * splits on "are there any holes"; the commit gate needs to know "which ones",
 * and the two must never be able to disagree about what a hole is.
 */
export function isBlankRow(
  student: TeacherRosterRow,
  fields: TeacherField[],
): boolean {
  return requiredKeys(student, fields).length > 0;
}

/**
 * Where a student's row has got to.
 *
 *   todo      — untouched. This is what the progress rail counts down.
 *   editing   — inputs are open and she is typing. NOT done yet.
 *   partial   — everything she typed is valid and finished, but a field the
 *               school holds nothing for is still empty. Her work goes to the
 *               school; the row is not done. It stays open on screen and stays
 *               in the count of what is left.
 *   confirmed — she tapped सही है.
 *   edited    — she corrected something, and every hole is filled.
 *   absent    — she tapped नहीं है.
 *
 * `editing` is deliberately not counted as done: a half-typed phone number is
 * not an answer, and a progress bar that says otherwise is lying to her.
 *
 * `partial` exists for the same reason one level up. A card asking for two
 * things with one of them filled used to commit itself as `edited`, collapse
 * out of edit mode, and count as done — so the second box was never seen again
 * by anybody. Splitting it out is what lets the row be sent and unfinished at
 * the same time, which is the truth about it.
 */
export type RowStatus =
  | "todo"
  | "editing"
  | "partial"
  | "confirmed"
  | "edited"
  | "absent";

/**
 * Send it to the school.
 *
 * Includes `partial`. Holding a real phone number on the phone because the
 * second box is empty loses it to a closed tab, and silence about work she
 * actually typed is the worse of the two failures.
 */
export const UPLOADABLE: RowStatus[] = [
  "confirmed",
  "edited",
  "absent",
  "partial",
];

/**
 * Count it as done.
 *
 * `partial` is deliberately absent — that is the whole bug. These two lists
 * replace a single ANSWERED because every place that used it meant one or the
 * other, and could not say which.
 */
export const COMPLETE: RowStatus[] = ["confirmed", "edited", "absent"];

export type RowState = {
  status: RowStatus;
  /** Only the fields she actually changed. An absent key means unchanged. */
  values: Record<string, string>;
};

/**
 * Where a row should START, given what the school already has from her.
 *
 * THE FIX FOR REOPENING A HALF-DONE ROUND. Every row used to arrive `todo` with
 * empty values, because the page only ever saw the frozen snapshot — so a
 * teacher who had photographed twelve of forty-six children came back to
 * forty-six empty cards and no way to tell which twelve were done. Her work was
 * in the submissions table the whole time; nothing asked for it.
 *
 * `sent` is the other half and is not cosmetic: it seeds sentIds, which is what
 * stops pickBatch from uploading these rows a second time under a fresh
 * idempotency key and writing a duplicate submission on every reload.
 *
 * Pure and here rather than in the component, for the reason autosave.ts gives.
 * It does NOT re-validate: every value it can see was validated by the server
 * on the way in, and a rule that could reject one here would silently drop work
 * the school has already accepted.
 */
export function seedRow(
  student: TeacherRosterRow,
  fields: TeacherField[],
): { row: RowState; sent: boolean } {
  if (student.notPresent) {
    return { row: { status: "absent", values: {} }, sent: true };
  }

  // Only the fields this request actually asks about, and only the ones that
  // carry a value. A `confirmed` answer to a field we hold nothing for writes
  // no submission at all (see recordSubmissions), so an empty string here would
  // be inventing an answer she never gave.
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = student.answered[field.key];
    if (value !== undefined && value !== null && value !== "") {
      values[field.key] = value;
    }
  }

  if (Object.keys(values).length === 0) {
    return { row: { status: "todo", values: {} }, sent: false };
  }

  // Against the MERGED values, so a hole the office had already filled before
  // the link went out does not read as one she still owes.
  const required = requiredKeys({ values: knownValues(student) }, fields);
  const done = required.every((key) => {
    const value = values[key];
    return value !== undefined && value !== "";
  });

  return {
    row: { status: done ? "edited" : "partial", values },
    sent: true,
  };
}
