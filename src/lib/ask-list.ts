import { indexStudents, matchByIdOrSr } from "./students-import";
import { cellToString, type ParsedTable } from "./excel";
import { compareClassLabels, compareStudentNames } from "./classes";
import type { Student } from "../../drizzle/schema";

/**
 * A list of specific children the office typed out, turned into an audience.
 *
 * THE CASE THIS EXISTS FOR: thirty-five families whose number is on record and
 * is not a WhatsApp number. Nothing about those children is missing — every
 * filter on the board says their records are complete — so no query finds them
 * and the office is the only thing that knows. It puts them in a sheet, writes
 * one sentence about why, and each class teacher gets a link carrying her own
 * share of them.
 *
 * PURE, AND NOTHING HERE WRITES. It takes the parsed sheet and the students it
 * might refer to, and answers "which children, and what was said about each".
 * The audience it produces goes through previewBatch and createBatch exactly as
 * a class selection does — see BulkSend.
 *
 * WHAT DID NOT MATCH IS THE POINT. A list of thirty-five that quietly becomes a
 * round of thirty-one is the worst thing this feature can do: the office
 * believes it asked about everyone, and the four it dropped are the four whose
 * rows were already wrong. So `unmatched` is returned beside `matched`, carries
 * the row number so the sheet can be fixed, and the screen states it in words
 * before anything is created. Same argument as planFanOut's `unassigned`.
 */

/**
 * The two sheets the template writes, and the upload looks for by name.
 *
 * Here rather than in either route, because the download and the upload are two
 * halves of one agreement about a file's shape — and a constant defined in one
 * route and imported by the other is a dependency between two HTTP endpoints
 * that has no reason to exist.
 */
export const CHILDREN_SHEET = "Children";
export const MESSAGE_SHEET = "Message";

/**
 * The exact header row the template writes.
 *
 * HERE RATHER THAN IN THE DOWNLOAD ROUTE, so that a test can drive this
 * module's own alias lists with the strings the office will actually be looking
 * at. They drifted once already: the template said "Name (not read)" while the
 * aliases below knew only "name", so the column was invisible to the matcher
 * and a row carrying a name and no id was read as the blank tail of the sheet.
 */
export const TEMPLATE_HEADERS = {
  id: "Student ID",
  srNo: "SR No",
  name: "Name (not read)",
  note: "Note to teacher",
  message: "Message to teachers",
} as const;

/** Header names the sheet may use, lower-cased. The template writes the first. */
const HEADERS = {
  id: ["student id", "studentid", "student_id", "id", "vpps id", "sid"],
  srNo: ["sr no", "sr_no", "srno", "sr number", "s.r. no", "sr"],
  note: ["note to teacher", "note", "remark", "remarks", "message"],
  /**
   * Read only so a mis-mapped sheet can be explained. NEVER a match key.
   *
   * "name (not read)" is what the template itself writes, and it has to be in
   * here or the column the office is looking at is one this module cannot see:
   * a row carrying a name and no id would then be indistinguishable from the
   * blank tail of a spreadsheet, and would vanish instead of being reported.
   * A test pins these aliases against the template's own header.
   */
  name: ["name (not read)", "name", "student", "student name", "child"],
};

export type AskListRow = {
  rowNumber: number;
  studentId: string;
  name: string;
  classLabel: string;
  note: string | null;
};

export type AskListMiss = {
  rowNumber: number;
  id: string | null;
  srNo: string | null;
  /** What was in the name column, so the office can find the row by eye. */
  name: string | null;
  reason: string;
};

export type AskListResult = {
  matched: AskListRow[];
  /** Named, never counted away. See the note at the top of this file. */
  unmatched: AskListMiss[];
  /** How many classes the matched children fall across. Drives the preview. */
  classLabels: string[];
};

/** Which column of the sheet holds what, by header name. */
function columnFor(headers: string[], aliases: string[]): string | null {
  const lower = headers.map((header) => header.trim().toLowerCase());
  for (const alias of aliases) {
    const index = lower.indexOf(alias);
    if (index !== -1) return headers[index]!;
  }
  return null;
}

/** Is this sheet usable at all? Answered before any row is read. */
export function hasIdentityColumn(headers: string[]): boolean {
  return (
    columnFor(headers, HEADERS.id) !== null ||
    columnFor(headers, HEADERS.srNo) !== null
  );
}

/**
 * Match every row of the sheet to a child, or say why it could not.
 *
 * `existing` is every student the caller loaded — active and not. A child who
 * has LEFT is matched and then refused with that as the reason, rather than
 * silently missing: audienceWhere forces `status = 'active'`, so an id that is
 * no longer on the roll would otherwise vanish between this screen and the
 * frozen roster with nothing said.
 */
export function matchAskList(
  table: ParsedTable,
  existing: Student[],
): AskListResult {
  const index = indexStudents(existing);

  const idColumn = columnFor(table.headers, HEADERS.id);
  const srColumn = columnFor(table.headers, HEADERS.srNo);
  const noteColumn = columnFor(table.headers, HEADERS.note);
  const nameColumn = columnFor(table.headers, HEADERS.name);

  const matched: AskListRow[] = [];
  const unmatched: AskListMiss[] = [];
  /** Two rows naming one child is a mistake in the sheet, not a second ask. */
  const seen = new Set<string>();

  table.rows.forEach((row, offset) => {
    // Row 1 is the header, so the first data row is row 2 — the number Excel
    // itself shows down the left, which is the only one the office can act on.
    const rowNumber = offset + 2;
    const id = idColumn ? cellToString(row[idColumn]).trim() : "";
    const srNo = srColumn ? cellToString(row[srColumn]).trim() : "";
    const note = noteColumn ? cellToString(row[noteColumn]).trim() : "";
    const name = nameColumn ? cellToString(row[nameColumn]).trim() : "";

    // A wholly blank row is the empty tail of a spreadsheet, not a failure.
    if (!id && !srNo && !note && !name) return;

    const miss = (reason: string) =>
      unmatched.push({
        rowNumber,
        id: id || null,
        srNo: srNo || null,
        name: name || null,
        reason,
      });

    if (!id && !srNo) {
      miss("No Student ID and no SR number — a name alone cannot identify a child");
      return;
    }

    const match = matchByIdOrSr(index, { id, srNo });
    if (match.ambiguous) {
      miss(match.ambiguous);
      return;
    }
    if (!match.student) {
      miss(
        id
          ? `No student has ID ${id}`
          : `No student has SR number ${srNo}`,
      );
      return;
    }

    const student = match.student;

    if (student.status !== "active") {
      miss(`${student.name} is no longer on the active roll`);
      return;
    }
    if (seen.has(student.id)) {
      miss(`${student.name} is already on an earlier row`);
      return;
    }
    seen.add(student.id);

    matched.push({
      rowNumber,
      studentId: student.id,
      name: student.name,
      classLabel: student.classLabel,
      note: note || null,
    });
  });

  matched.sort(
    (a, b) =>
      compareClassLabels(a.classLabel, b.classLabel) ||
      compareStudentNames(a.name, b.name),
  );

  return {
    matched,
    unmatched,
    classLabels: [...new Set(matched.map((row) => row.classLabel))].sort(
      compareClassLabels,
    ),
  };
}

/** The notes, keyed by student id, in the shape an Audience carries. */
export function notesFrom(matched: AskListRow[]): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const row of matched) {
    if (row.note) notes[row.studentId] = row.note;
  }
  return notes;
}

/**
 * The office's one sentence for the whole round, from the template's cell.
 *
 * The template puts it on its own sheet with one column, so it arrives here as
 * a one-row table. Read defensively: a sheet the office has rearranged is a
 * round without a message, not a failed upload.
 */
export function messageFrom(table: ParsedTable | null): string | null {
  if (!table || table.rows.length === 0) return null;
  const header = table.headers[0];
  if (!header) return null;
  for (const row of table.rows) {
    const value = cellToString(row[header]).trim();
    if (value) return value;
  }
  return null;
}
