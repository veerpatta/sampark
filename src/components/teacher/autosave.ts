import { validateField } from "@/lib/fields";
import { UPLOADABLE, type RowState, type TeacherField } from "./types";

/**
 * The decisions behind saving as she types.
 *
 * Pure and separate from the component for the reason summary.ts is: these are
 * the rules, the component is the plumbing, and a rule that can be tested
 * without a DOM is a rule that gets tested. See tests/autosave.test.ts.
 */

/** After the last keystroke in a row, before it commits itself. */
export const ROW_COMMIT_MS = 1000;

/** After a row commits, before the batch of committed rows is uploaded. */
export const FLUSH_AFTER_MS = 3000;

/** Rows waiting before an upload is triggered without waiting out the timer. */
export const FLUSH_AT_ROWS = 5;

/**
 * The floor between two uploads.
 *
 * The teacher bucket is 30 requests a minute per token (lib/ratelimit.ts). A
 * fast typist on "five rows or three seconds" reaches roughly twenty a minute
 * before the page's own navigation, which leaves no headroom for a retry. Four
 * seconds caps it at fifteen and the work still lands within a few seconds of
 * being typed, which is all that was promised.
 */
export const MIN_FLUSH_INTERVAL_MS = 4000;

const filled = (row: RowState, key: string) => {
  const value = row.values[key];
  return value !== undefined && value !== "";
};

export type RowVerdict = "unfinished" | "partial" | "ready";

/**
 * How far has this row got?
 *
 *   unfinished — nothing typed, or something typed is invalid or half-typed.
 *                Goes nowhere and counts as nothing. A row she opened and left
 *                alone is not an answer, and committing it would tell the
 *                office it had been checked when nobody looked. A fixed-length
 *                field with four of ten digits is not invalid yet — it is
 *                unfinished — and a timer must never decide that an unfinished
 *                number is her answer.
 *   partial    — everything she typed is settled, but `required` is not
 *                covered. Send what she typed; never call it done.
 *   ready      — settled and complete.
 *
 * `required` is the list from requiredKeys() in types.ts: the fields the school
 * holds nothing for, precomputed by the caller. Taking the keys rather than the
 * roster row keeps this a pure function over two plain arrays, and a rule that
 * can be tested without a DOM is a rule that gets tested.
 *
 * It DEFAULTS TO EMPTY, and that default is not laziness — it is the old rule,
 * which is still the right one for a row where the school already holds
 * everything. Untouched there means "unchanged, still right". Making the
 * argument mandatory would turn every untouched verify field into a hole, which
 * is the opposite failure and a louder one.
 */
export function judgeRow(
  fields: TeacherField[],
  row: RowState,
  required: string[] = [],
): RowVerdict {
  const entered = fields.filter((field) => filled(row, field.key));
  if (entered.length === 0) return "unfinished";

  for (const field of entered) {
    const value = row.values[field.key]!;
    if (field.exactLen && value.replace(/\D/g, "").length < field.exactLen) {
      return "unfinished";
    }
    if (!validateField(field, value).ok) return "unfinished";
  }

  return required.every((key) => filled(row, key)) ? "ready" : "partial";
}

/** Settled and complete — every hole filled. */
export function rowReady(
  fields: TeacherField[],
  row: RowState,
  required: string[] = [],
): boolean {
  return judgeRow(fields, row, required) === "ready";
}

/** Settled, sendable, and still missing something the school asked for. */
export function rowPartial(
  fields: TeacherField[],
  row: RowState,
  required: string[] = [],
): boolean {
  return judgeRow(fields, row, required) === "partial";
}

/**
 * Is there nothing more that could legally be typed into this box?
 *
 * The question the caret advance actually needs, and until now it could only
 * ask a narrower one: "has a fixed-length field reached its length". That
 * covers a phone number and an Aadhaar number and nothing else — FA marks are
 * `number` with `maxValue` and no `exactLen`, so on a marks round EVERY box
 * needed an explicit Enter. Enter works, so it was one keypress per mark rather
 * than a hunt; on a five-subject round for forty-six children it was still 230
 * of them.
 *
 * Two ways a box can be finished:
 *
 *   - it reached its fixed length. Ten digits of ten.
 *   - it is a bounded number and another digit could not produce a legal value.
 *     Appending "0" is the SMALLEST thing the next keystroke could do, so if
 *     even that exceeds the maximum, nothing else can help. Out of 25: after
 *     "3", 30 > 25, finished. After "1", 10 ≤ 25, so she may be typing 18 and
 *     must be left alone. After "18", 180 > 25, finished. Marks 0, 1 and 2 are
 *     the only ones that still need an Enter, because 20-25 are live.
 *
 * A value that does not validate is never terminal. A mark of 26 is wrong, and
 * moving her on from a box showing an error would hide the error.
 *
 * Pure, and here rather than in the component, for the reason at the top of
 * this file. See tests/autosave.test.ts.
 */
export function terminal(field: TeacherField, value: string): boolean {
  if (value === "") return false;

  if (field.exactLen !== null && value.length >= field.exactLen) return true;

  if (field.inputType === "number" && field.maxValue !== null) {
    const max = Number(field.maxValue);
    if (!Number.isFinite(max)) return false;
    if (!validateField(field, value).ok) return false;
    return Number(`${value}0`) > max;
  }

  return false;
}

/**
 * Can this text still grow into a different option?
 *
 * For the type-to-filter box that stands in for a select above a dozen options
 * — twenty-nine bus routes, where a full-screen native wheel per child is the
 * thing being avoided. Moving her on the instant the text matches an option is
 * usually right and occasionally awful: with "Amet" and "Amet Road" both on the
 * list, she types A-m-e-t and the caret leaves for the next child while she is
 * still four keystrokes from what she meant.
 *
 * So: an exact match, and nothing on the list extends it. That is the only
 * state in which there is provably nothing left to type, and it needs no
 * guessing about which browser reports a dropdown pick differently from a
 * keystroke.
 */
export function soleMatch(options: string[], value: string): boolean {
  if (value === "") return false;
  if (!options.includes(value)) return false;
  return !options.some(
    (option) => option !== value && option.startsWith(value),
  );
}

/** The holes still open. Drives the highlight and the "2 में से 1 भरा" line. */
export function missingRequired(row: RowState, required: string[]): string[] {
  return required.filter((key) => !filled(row, key));
}

/** Whether anything at all has been typed into this row. */
export function rowTouched(row: RowState): boolean {
  return Object.values(row.values).some((value) => value !== "");
}

/**
 * Which students belong in the next upload.
 *
 * Uploadable, not already acknowledged by the server, and not part of the
 * request currently in the air. Excluding the in-flight ones is what stops a row
 * she corrects mid-upload from being written under a key that has already been
 * used for it — see the idempotency note in RequestForm.
 *
 * UPLOADABLE and not COMPLETE: a partial row is not done, but it is not nothing
 * either, and a real phone number should not sit on the phone waiting for a
 * second box she may fill tomorrow.
 */
export function pickBatch(
  order: { studentId: string }[],
  rows: Record<string, RowState>,
  sentIds: Set<string>,
  inFlight: Set<string>,
): string[] {
  return order
    .map((row) => row.studentId)
    .filter((id) => {
      const row = rows[id];
      if (!row) return false;
      return (
        UPLOADABLE.includes(row.status) &&
        !sentIds.has(id) &&
        !inFlight.has(id)
      );
    });
}

/** Is it time to upload? Either enough has piled up, or enough time has passed. */
export function shouldFlush(
  waiting: number,
  msSinceLastCommit: number,
  msSinceLastFlush: number,
): boolean {
  if (waiting === 0) return false;
  if (msSinceLastFlush < MIN_FLUSH_INTERVAL_MS) return false;
  return waiting >= FLUSH_AT_ROWS || msSinceLastCommit >= FLUSH_AFTER_MS;
}
