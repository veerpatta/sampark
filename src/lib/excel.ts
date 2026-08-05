/**
 * Excel read (import) and write (export).
 *
 * Principle 9: the office runs on Excel. Any collected dataset must come out as
 * a clean .xlsx. Implemented in Phase 1 (import) and Phase 4 (export).
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *  1. IMPORT MATCHING — match on student ID first, then SR number, NEVER on
 *     name. A blank cell means "no change", not "erase". A missing SR is a
 *     warning, not a blocker. A row with only name + class is valid.
 *
 *  2. FA MARKS EXPORT — must match the existing FA_Marks_Pattern.xlsx layout
 *     exactly: header rows for school name / course type / exam date / total
 *     marks, then the columns
 *       Student Name | Maths | Physics | Chemistry | Biology | Science combine
 *     with the combine column computed. The whole point is that the file goes
 *     to LEAD without anyone touching it in Excel.
 */

export type ImportRowOutcome = "insert" | "update" | "skip" | "error";

export type ImportPreviewRow = {
  rowNumber: number;
  outcome: ImportRowOutcome;
  studentId: string | null;
  matchedBy: "id" | "sr_no" | null;
  changes: Record<string, { from: string | null; to: string | null }>;
  message?: string;
};

export type ImportPreview = {
  rows: ImportPreviewRow[];
  counts: Record<ImportRowOutcome, number>;
};

// TODO (Phase 1): parseStudentUpload(file, columnMap) -> ImportPreview
// TODO (Phase 1): applyStudentUpload(preview) — writes only on explicit confirm
// TODO (Phase 4): exportStudentsWorkbook() — one sheet per class
// TODO (Phase 4): exportFaMarksWorkbook(requestId) — LEAD's exact layout

export {};
