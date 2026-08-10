import type { Student } from "../../drizzle/schema";

/**
 * How much of a child's record the school actually holds.
 *
 * The point of this app is closing holes, and until now the only way to see
 * where they were was to open five hundred detail pages one at a time. One
 * number per child turns that into a sort.
 *
 * WHAT COUNTS IS A DELIBERATE, SHORT LIST. Not every column on `students` —
 * `address` duplicates `village`, `alt_phone` is a bonus rather than a hole,
 * `admission_no` and `sr_no` come from PSP and are not something a teacher can
 * supply. These twelve are the fields the office actually chases, which is what
 * makes the score mean "how much is left to collect" rather than "how full is
 * this row".
 *
 * `aadhaar_last4` does NOT satisfy `aadhaar`. PSP masks it, 328 of 504 rows
 * carry the last four digits only, and treating that as a filled field would
 * make the school look finished on the one field it has none of.
 *
 * Pure, so the board and a test ask the same question.
 */
export const TRACKED_FIELDS = [
  "phone",
  "fatherName",
  "motherName",
  "dob",
  "gender",
  "category",
  "aadhaar",
  "janAadhaar",
  "village",
  "busRoute",
  "house",
  "photoPath",
] as const satisfies readonly (keyof Student)[];

export type Completeness = { filled: number; total: number; percent: number };

export function completeness(student: Student): Completeness {
  const filled = TRACKED_FIELDS.filter((field) => {
    const value = student[field];
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;

  return {
    filled,
    total: TRACKED_FIELDS.length,
    percent: Math.round((filled / TRACKED_FIELDS.length) * 100),
  };
}

/**
 * The same score as one SQL expression, for sorting in the database.
 *
 * Kept next to TRACKED_FIELDS rather than hand-written at the call site,
 * because a sort that disagrees with the bar next to it is worse than no sort:
 * the office would order by one number and read another. The column names are
 * the snake_case ones, so this is the one place the two spellings meet.
 */
export const COMPLETENESS_COLUMNS = [
  "phone",
  "father_name",
  "mother_name",
  "dob",
  "gender",
  "category",
  "aadhaar",
  "jan_aadhaar",
  "village",
  "bus_route",
  "house",
  "photo_path",
] as const;
