import { getTableColumns } from "drizzle-orm";
import { schema } from "./db";
import { isoDay } from "./today";
import type { ExportColumn } from "./excel";
import type { Student } from "../../drizzle/schema";

/**
 * What the students workbook contains — which is EVERYTHING the app holds
 * about a child.
 *
 * IN lib RATHER THAN IN THE ROUTE, so a test can read it. That is not tidiness:
 * `house` sat in the schema, on the board as a chip, on a child's page and on
 * every teacher's roster, and was missing from this file for as long as it has
 * existed — because the list was written by hand and nobody re-read it when a
 * column was added. A list nothing can check is a list that drifts. EXPORTED
 * below is checked against the live schema by tests/student-export.test.ts, and
 * a new students column now fails that test until it is either given a column
 * here or written into DELIBERATELY_ABSENT with a reason.
 *
 * Header names are load-bearing and must not be renamed casually: the office
 * exports this file, corrects it in Excel and imports it again, and the
 * importer maps by header name. The same test walks every header back through
 * suggestColumnMap to prove that round trip still closes.
 */

/**
 * Students columns this file does not carry as text, and why.
 *
 * The photograph is the only entry, and it IS in the workbook — drawn into the
 * cell as a picture. What is left out is its blob pathname, which is an
 * internal identifier: unreadable to a person, meaningless to PSP, and not
 * something to paste into a spreadsheet that gets emailed.
 */
export const DELIBERATELY_ABSENT: Partial<Record<keyof Student, string>> = {
  photoPath: "drawn into the Photo column as the picture itself",
};

/** Every students column, as it is spelled in the database. */
export const STUDENT_COLUMNS = new Set(
  Object.values(getTableColumns(schema.students)).map((column) => column.name),
);

/**
 * The workbook's columns, given the photographs already fetched.
 *
 * A function rather than a constant because the Photo column has to close over
 * the images. Everything else is unchanged and still in the order the importer
 * reads, so export -> fix in Excel -> re-import still round-trips.
 */
export const studentExportColumns = (
  photos: Map<string, Buffer>,
): ExportColumn<Student>[] => [
  { header: "Student ID", width: 14, value: (s) => s.id },
  { header: "SR No", width: 12, value: (s) => s.srNo },
  { header: "Admission No", width: 14, value: (s) => s.admissionNo },
  { header: "Class", width: 10, value: (s) => s.classLabel },
  { header: "Section", width: 9, value: (s) => s.section },
  { header: "Roll No", width: 9, value: (s) => s.rollNo },
  { header: "Name", width: 26, value: (s) => s.name },
  { header: "Father's Name", width: 24, value: (s) => s.fatherName },
  { header: "Mother's Name", width: 24, value: (s) => s.motherName },
  { header: "Mobile No", width: 14, value: (s) => s.phone },
  { header: "Alternate Mobile", width: 16, value: (s) => s.altPhone },
  { header: "Date of Birth", width: 13, value: (s) => s.dob },
  { header: "Gender", width: 9, value: (s) => s.gender },
  { header: "Category", width: 10, value: (s) => s.category },
  { header: "Aadhaar", width: 16, value: (s) => s.aadhaar },
  /*
   * Beside the full number, never folded into it.
   *
   * PSP masks Aadhaar and publishes the last four digits for most children —
   * see the column's note in the schema for why those can never be written into
   * `aadhaar`. It is the only Aadhaar information the school holds for the
   * majority of the roll, so leaving it out of the file left the office
   * reconciling against a column that is empty for two thirds of the school.
   */
  { header: "Aadhaar Last 4", width: 15, value: (s) => s.aadhaarLast4 },
  { header: "Jan Aadhaar", width: 16, value: (s) => s.janAadhaar },
  { header: "Village", width: 18, value: (s) => s.village },
  { header: "Address", width: 30, value: (s) => s.address },
  { header: "Bus Route", width: 14, value: (s) => s.busRoute },
  /*
   * THE ONE THAT WAS ACTUALLY MISSING, and the reason the rest of this was
   * looked at. A house is on the board as a chip, on a child's page, and on
   * every teacher's roster as a recognition aid — and it was in none of the
   * three places that read IMPORT_COLUMNS, because it was added to the schema
   * after that list was written. Collectable, collected, and unreadable.
   */
  { header: "House", width: 14, value: (s) => s.house },
  { header: "Status", width: 10, value: (s) => s.status },
  /*
   * THE PICTURE ITSELF, not a pathname and not "yes".
   *
   * A blob pathname in a spreadsheet is a dead string — unreadable to a person
   * and meaningless to PSP — and "yes" answers the wrong question. What the
   * office wants this file for is a printed class list with faces on it.
   *
   * `value` still fills the cell when there is no photograph, so the column
   * reads as a work list rather than as a row of holes.
   */
  {
    // Wide enough to hold the picture. Excel measures a column in characters of
    // the default font, roughly 7px each, so a 96px face needs about 14 — and a
    // narrower column would crop it against the next one rather than shrink it.
    header: "Photo",
    width: 15,
    value: (s) => (s.photoPath ? "" : "no photo"),
    image: (s) => photos.get(s.id) ?? null,
  },
  /*
   * PROVENANCE, LAST, so the columns the office knows keep their places.
   *
   * None of these are importable and none are on a screen — `source` says which
   * system a child came from and the two dates say when the row last moved. The
   * office asked for a file that holds everything the app does, and "when did
   * this record last change" is the question a spreadsheet is genuinely better
   * at answering than the board is.
   *
   * The school's day, not the server's: a record touched at 1am IST belongs to
   * that date, and toIsoDate on a UTC clock would file it under the day before.
   */
  { header: "Source", width: 10, value: (s) => s.source },
  { header: "Added On", width: 12, value: (s) => isoDay(s.createdAt) },
  { header: "Last Updated", width: 13, value: (s) => isoDay(s.updatedAt) },
];
