import { validateField } from "@/lib/fields";
import { ANSWERED, type RowState, type TeacherField } from "./types";

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

/**
 * Is this row safe to commit on its own?
 *
 * Three things have to be true, and the last is the one that matters:
 *
 *   - she has actually entered something. A row she opened and left alone is
 *     not an answer, and committing it would tell the office it had been
 *     checked when nobody looked.
 *   - every value she HAS entered validates.
 *   - nothing is half-typed. A fixed-length field with four of ten digits is
 *     not invalid yet — it is unfinished — and a timer must never decide that
 *     an unfinished number is her answer.
 */
export function rowReady(fields: TeacherField[], row: RowState): boolean {
  const entered = fields.filter((field) => {
    const value = row.values[field.key];
    return value !== undefined && value !== "";
  });

  if (entered.length === 0) return false;

  return entered.every((field) => {
    const value = row.values[field.key]!;
    if (field.exactLen && value.replace(/\D/g, "").length < field.exactLen) {
      return false;
    }
    return validateField(field, value).ok;
  });
}

/** Whether anything at all has been typed into this row. */
export function rowTouched(row: RowState): boolean {
  return Object.values(row.values).some((value) => value !== "");
}

/**
 * Which students belong in the next upload.
 *
 * Answered, not already acknowledged by the server, and not part of the request
 * currently in the air. Excluding the in-flight ones is what stops a row she
 * corrects mid-upload from being written under a key that has already been used
 * for it — see the idempotency note in RequestForm.
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
        ANSWERED.includes(row.status) &&
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
