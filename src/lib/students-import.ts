import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import {
  isClassLabel,
  normaliseClassLabel,
  unknownClassLabelMessage,
} from "./classes";
import {
  cellToString,
  excelSerialToDate,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRowOutcome,
  type ParsedTable,
} from "./excel";
import type { Student } from "../../drizzle/schema";

/**
 * Student import: match, diff, preview, apply.
 *
 * The three rules that carry the whole thing (plan Phase 1, and rule 7 of the
 * standing rules):
 *
 *   1. Match on student ID first, then SR number. NEVER on name. Two children
 *      in a village school share a name more often than you would think, and
 *      overwriting the wrong one is not recoverable from a spreadsheet.
 *   2. A blank cell means "no change". It never means "erase". This is why the
 *      diff below skips empty values on update instead of writing null.
 *   3. A missing SR number is a warning, not a blocker, and a row carrying only
 *      a name and a class is valid.
 *
 * Nothing here writes. `buildPreview` is pure with respect to the database and
 * `applyPreview` runs only on an explicit confirmation from the UI.
 */

export type StudentColumn = Exclude<
  keyof Student,
  "createdAt" | "updatedAt" | "source"
>;

type ColumnSpec = {
  column: StudentColumn;
  label: string;
  /** Lowercased header names seen in real PSP exports, for auto-mapping. */
  aliases: string[];
  normalise: (raw: string) => { value: string | null; warning?: string };
};

const text = (raw: string) => ({ value: collapse(raw) || null });

const phone = (label: string) => (raw: string) => {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10) {
    return {
      value: null,
      warning: `${label} "${raw}" is not 10 digits — left unchanged`,
    };
  }
  return { value: digits };
};

const oneOf = (label: string, allowed: string[]) => (raw: string) => {
  const value = collapse(raw).toUpperCase();
  if (!allowed.includes(value)) {
    return {
      value: null,
      warning: `${label} "${raw}" is not one of ${allowed.join("/")} — left unchanged`,
    };
  }
  return { value };
};

/**
 * Every students column the office might reasonably load from PSP. Order is the
 * order the mapping UI shows them in.
 */
export const IMPORT_COLUMNS: ColumnSpec[] = [
  {
    column: "id",
    label: "Student ID",
    aliases: ["student id", "studentid", "student_id", "id", "vpps id", "sid"],
    normalise: (raw) => ({ value: collapse(raw) || null }),
  },
  {
    column: "srNo",
    label: "SR number",
    aliases: ["sr no", "sr_no", "srno", "sr number", "s.r. no", "sr"],
    normalise: text,
  },
  {
    column: "admissionNo",
    label: "Admission number",
    aliases: ["admission no", "adm no", "admission number", "admission_no"],
    normalise: text,
  },
  {
    column: "classLabel",
    label: "Class",
    aliases: ["class", "class label", "class_label", "standard", "std"],
    // Validated, not just normalised. The fee app is the source of truth for
    // class labels and Sampark must join back to it on this exact string — so a
    // label off the list is a loud row error, never a new class. See planRow.
    normalise: (raw) => {
      const label = normaliseClassLabel(raw);
      if (!label) return { value: null };
      if (!isClassLabel(label)) {
        return { value: null, warning: unknownClassLabelMessage(label) };
      }
      return { value: label };
    },
  },
  {
    column: "section",
    label: "Section",
    aliases: ["section", "sec"],
    normalise: text,
  },
  {
    column: "rollNo",
    label: "Roll number",
    aliases: ["roll no", "roll", "roll number", "roll_no"],
    normalise: (raw) => {
      const digits = raw.replace(/\D/g, "");
      if (!digits) {
        return { value: null, warning: `Roll number "${raw}" is not a number` };
      }
      return { value: String(Number(digits)) };
    },
  },
  {
    column: "name",
    label: "Name",
    aliases: [
      "name",
      "student",
      "student name",
      "student's name",
      "students name",
    ],
    normalise: text,
  },
  {
    column: "fatherName",
    label: "Father's name",
    aliases: ["father name", "father's name", "fathers name", "father"],
    normalise: text,
  },
  {
    column: "motherName",
    label: "Mother's name",
    aliases: ["mother name", "mother's name", "mothers name", "mother"],
    normalise: text,
  },
  {
    column: "phone",
    label: "Mobile number",
    // "father phone" is the fee app's header, and it is the number the office
    // actually rings. It lands in `phone`, the primary.
    aliases: [
      "father phone",
      "fathers phone",
      "father's phone",
      "mobile",
      "mobile no",
      "mobile number",
      "phone",
      "contact",
      "contact no",
      "parent mobile",
    ],
    normalise: phone("Mobile number"),
  },
  {
    column: "altPhone",
    label: "Mother's mobile",
    aliases: [
      "mother phone",
      "mothers phone",
      "mother's phone",
      "alternate mobile",
      "alt mobile",
      "alternate number",
      "second mobile",
      "alt_phone",
    ],
    normalise: phone("Mother's mobile"),
  },
  {
    column: "dob",
    label: "Date of birth",
    aliases: ["dob", "date of birth", "birth date", "birthdate"],
    normalise: (raw) => {
      const value = parseIndianDate(raw);
      return value
        ? { value }
        : { value: null, warning: `Date of birth "${raw}" is not a date` };
    },
  },
  {
    column: "gender",
    label: "Gender",
    aliases: ["gender", "sex"],
    normalise: text,
  },
  {
    column: "category",
    label: "Category",
    aliases: ["category", "caste category", "cat", "caste"],
    normalise: oneOf("Category", ["GEN", "OBC", "SC", "ST", "EWS"]),
  },
  {
    column: "aadhaar",
    label: "Aadhaar",
    aliases: ["aadhaar", "aadhar", "aadhaar no", "aadhar no", "uid"],
    normalise: (raw) => {
      const digits = raw.replace(/\D/g, "");
      if (digits.length !== 12) {
        return {
          value: null,
          warning: `Aadhaar "${raw}" is not 12 digits — left unchanged`,
        };
      }
      return { value: digits };
    },
  },
  {
    column: "janAadhaar",
    label: "Jan Aadhaar",
    aliases: ["jan aadhaar", "jan aadhar", "janaadhaar", "jan_aadhaar"],
    normalise: text,
  },
  {
    column: "village",
    label: "Village",
    aliases: ["village", "gaon", "gram"],
    normalise: text,
  },
  {
    column: "address",
    label: "Address",
    aliases: ["address", "residential address"],
    normalise: text,
  },
  {
    column: "busRoute",
    label: "Bus route",
    aliases: ["bus route", "route", "transport route", "bus_route"],
    normalise: text,
  },
  {
    column: "status",
    label: "Status",
    aliases: ["status"],
    normalise: (raw) => {
      const value = collapse(raw).toLowerCase().replace(/\s+/g, "_");
      if (!["active", "left", "tc_issued"].includes(value)) {
        return {
          value: null,
          warning: `Status "${raw}" is not active/left/tc_issued — left unchanged`,
        };
      }
      return { value };
    },
  },
];

const COLUMN_BY_KEY = new Map(IMPORT_COLUMNS.map((spec) => [spec.column, spec]));

/** header name -> students column. Headers the office chose to ignore are absent. */
export type ColumnMap = Partial<Record<string, StudentColumn>>;

/**
 * Best guess at a mapping, offered as the starting point in the UI. It is only
 * a suggestion — the office confirms every column before anything is written.
 */
export function suggestColumnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const taken = new Set<StudentColumn>();

  for (const header of headers) {
    const needle = collapse(header).toLowerCase().replace(/[._]/g, " ");
    const match = IMPORT_COLUMNS.find(
      (spec) => !taken.has(spec.column) && spec.aliases.includes(needle),
    );
    if (match) {
      map[header] = match.column;
      taken.add(match.column);
    }
  }
  return map;
}

export type ImportPlanRow = {
  preview: ImportPreviewRow;
  /** Absent for error and skip rows. */
  write?:
    | { kind: "insert"; values: Record<string, unknown> }
    | { kind: "update"; id: string; values: Record<string, unknown> };
};

export type ImportPlan = ImportPreview & { writes: ImportPlanRow[] };

/**
 * Work out what the file would do, without doing any of it.
 *
 * Reads the students it might touch (by ID and by SR number) and diffs each
 * mapped cell against what is already stored.
 */
export async function buildPreview(
  table: ParsedTable,
  map: ColumnMap,
): Promise<ImportPlan> {
  const mapped = mappedPairs(map);

  const ids: string[] = [];
  const srNos: string[] = [];
  for (const row of table.rows) {
    const id = valueFor(row, mapped, "id");
    const sr = valueFor(row, mapped, "srNo");
    if (id) ids.push(id);
    if (sr) srNos.push(sr);
  }

  return planRows(table, map, await loadCandidates(ids, srNos));
}

/**
 * The matching and diff rules, with the database lifted out.
 *
 * `existing` is the set of students the file could possibly touch. Keeping this
 * pure is deliberate: rule 7 (ID first, then SR, never name; blank means no
 * change) is the part of the importer where a bug quietly corrupts the master
 * record, and a pure function is one that can be tested without a connection.
 */
export function planRows(
  table: ParsedTable,
  map: ColumnMap,
  existing: Student[],
): ImportPlan {
  const mapped = mappedPairs(map);

  const byId = new Map<string, Student>();
  const bySr = new Map<string, Student[]>();

  for (const student of existing) {
    byId.set(student.id, student);
    if (student.srNo) {
      const list = bySr.get(student.srNo) ?? [];
      list.push(student);
      bySr.set(student.srNo, list);
    }
  }

  // Two rows in one file claiming the same identity is a data-entry mistake in
  // the source, not something to resolve silently.
  const seenInFile = new Set<string>();

  const writes: ImportPlanRow[] = [];
  const counts: Record<ImportRowOutcome, number> = {
    insert: 0,
    update: 0,
    skip: 0,
    error: 0,
  };

  table.rows.forEach((row, index) => {
    // +2 because row 1 is the header and spreadsheets count from 1 — the number
    // shown in the preview has to be the number the office sees in Excel.
    const plan = planRow(row, index + 2, mapped, byId, bySr, seenInFile);
    counts[plan.preview.outcome] += 1;
    writes.push(plan);
  });

  return { rows: writes.map((entry) => entry.preview), counts, writes };
}

function mappedPairs(map: ColumnMap): [string, StudentColumn][] {
  return Object.entries(map).filter(([, column]) => Boolean(column)) as [
    string,
    StudentColumn,
  ][];
}

function planRow(
  row: Record<string, string>,
  rowNumber: number,
  mapped: [string, StudentColumn][],
  byId: Map<string, Student>,
  bySr: Map<string, Student[]>,
  seenInFile: Set<string>,
): ImportPlanRow {
  const warnings: string[] = [];
  const values: Partial<Record<StudentColumn, string>> = {};

  let badClass: string | null = null;

  for (const [header, column] of mapped) {
    const raw = row[header] ?? "";
    // A blank cell means "no change" — never "erase". Skip it entirely.
    if (raw.trim() === "") continue;

    const spec = COLUMN_BY_KEY.get(column)!;
    const { value, warning } = spec.normalise(coerceCell(raw, column));
    if (column === "classLabel" && value === null && warning) {
      badClass = warning;
      continue;
    }
    if (warning) warnings.push(warning);
    if (value !== null) values[column] = value;
  }

  const id = values.id ?? null;
  const srNo = values.srNo ?? null;

  const error = (message: string): ImportPlanRow => ({
    preview: {
      rowNumber,
      outcome: "error",
      studentId: id,
      matchedBy: null,
      changes: {},
      message,
      warnings,
    },
  });

  // A class label off the canonical nineteen fails the whole row, on update as
  // much as on insert. Dropping just the bad cell would file the child under
  // whatever class they were already in and look like a clean import; there is
  // no case where the fee app legitimately emits another label, so a mismatch
  // means the file or the list is wrong and someone has to look.
  if (badClass) return error(badClass);

  // ---- match: ID first, then SR number, never name ----
  let existing: Student | undefined;
  let matchedBy: "id" | "sr_no" | null = null;

  if (id) {
    existing = byId.get(id);
    matchedBy = existing ? "id" : null;
    if (seenInFile.has(`id:${id}`)) {
      warnings.push(`Student ID ${id} appears more than once in this file`);
    }
    seenInFile.add(`id:${id}`);
  } else if (srNo) {
    const candidates = bySr.get(srNo) ?? [];
    if (candidates.length > 1) {
      return error(
        `SR number ${srNo} matches ${candidates.length} students — fix the source file or add a Student ID column`,
      );
    }
    existing = candidates[0];
    matchedBy = existing ? "sr_no" : null;
    if (seenInFile.has(`sr:${srNo}`)) {
      warnings.push(`SR number ${srNo} appears more than once in this file`);
    }
    seenInFile.add(`sr:${srNo}`);
  }

  if (existing) return planUpdate(existing, values, rowNumber, matchedBy, warnings);

  // ---- no match: this is a new student ----
  if (!values.name) return error("No name — cannot create a student record");
  if (!values.classLabel) {
    return error(`No class for "${values.name}" — cannot create a record`);
  }

  // SR no becomes the key when there is no better one. The fee app has no
  // separate student ID, SR numbers are unique in its export, and a real key
  // means re-importing the same file updates rather than duplicating — which a
  // generated TMP- id could never do.
  if (!id && !srNo) {
    warnings.push(
      `No Student ID or SR number — a new record will be created, and importing this file again would create a second one`,
    );
  }

  const newId = id ?? srNo ?? temporaryStudentId();
  const insertValues: Record<string, unknown> = { ...values, id: newId };
  if (insertValues.rollNo !== undefined) {
    insertValues.rollNo = Number(insertValues.rollNo);
  }

  return {
    preview: {
      rowNumber,
      outcome: "insert",
      studentId: newId,
      matchedBy: null,
      changes: Object.fromEntries(
        Object.entries(values)
          .filter(([column]) => column !== "id")
          .map(([column, value]) => [column, { from: null, to: String(value) }]),
      ),
      warnings,
    },
    write: { kind: "insert", values: insertValues },
  };
}

function planUpdate(
  existing: Student,
  values: Partial<Record<StudentColumn, string>>,
  rowNumber: number,
  matchedBy: "id" | "sr_no" | null,
  warnings: string[],
): ImportPlanRow {
  const changes: ImportPreviewRow["changes"] = {};
  const update: Record<string, unknown> = {};

  for (const [column, incoming] of Object.entries(values) as [
    StudentColumn,
    string,
  ][]) {
    if (column === "id") continue; // the match key is never rewritten

    const current = existing[column];
    const currentText = current === null || current === undefined ? null : String(current);
    if (currentText === incoming) continue;

    changes[column] = { from: currentText, to: incoming };
    update[column] = column === "rollNo" ? Number(incoming) : incoming;
  }

  if (Object.keys(update).length === 0) {
    return {
      preview: {
        rowNumber,
        outcome: "skip",
        studentId: existing.id,
        matchedBy,
        changes: {},
        message: "Already matches",
        warnings,
      },
    };
  }

  return {
    preview: {
      rowNumber,
      outcome: "update",
      studentId: existing.id,
      matchedBy,
      changes,
      warnings,
    },
    write: { kind: "update", id: existing.id, values: update },
  };
}

/**
 * Write the plan. Called only after the office has seen the preview and
 * confirmed it.
 *
 * Chunked rather than wrapped in one big transaction: the neon-http driver has
 * no interactive transactions, but db.batch sends a chunk as a single atomic
 * unit, so a chunk either lands completely or not at all. Re-running a failed
 * import is safe for every row that matched on ID or SR — the preview simply
 * shows fewer changes the second time. Rows with no ID and no SR are the
 * exception, and the preview warns about exactly those.
 */
export async function applyPreview(plan: ImportPlan): Promise<{
  inserted: number;
  updated: number;
}> {
  const inserts = plan.writes
    .filter((entry) => entry.write?.kind === "insert")
    .map((entry) => entry.write!.values as typeof schema.students.$inferInsert);

  const updates = plan.writes
    .map((entry) => entry.write)
    .filter((write) => write?.kind === "update");

  for (const chunk of chunked(inserts, 100)) {
    await db.insert(schema.students).values(chunk);
  }

  for (const chunk of chunked(updates, 25)) {
    const statements = chunk.map((write) =>
      db
        .update(schema.students)
        .set({ ...write.values, updatedAt: new Date() })
        .where(eq(schema.students.id, write.id)),
    );
    await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  }

  return { inserted: inserts.length, updated: updates.length };
}

async function loadCandidates(
  ids: string[],
  srNos: string[],
): Promise<Student[]> {
  const found: Student[] = [];

  for (const chunk of chunked([...new Set(ids)], 200)) {
    found.push(
      ...(await db
        .select()
        .from(schema.students)
        .where(inArray(schema.students.id, chunk))),
    );
  }

  for (const chunk of chunked([...new Set(srNos)], 200)) {
    found.push(
      ...(await db
        .select()
        .from(schema.students)
        .where(inArray(schema.students.srNo, chunk))),
    );
  }

  return found;
}

/**
 * A student with neither an ID nor an SR number still gets a record — the plan
 * is explicit that name + class is a valid row. The TMP- prefix is deliberately
 * ugly so it shows up in the students list and gets replaced with the real PSP
 * ID rather than living forever.
 */
function temporaryStudentId(): string {
  return `TMP-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * XLSX date cells arrive as Excel serial numbers. Only the date column wants
 * that interpretation — a roll number of 45000 is a roll number.
 */
function coerceCell(raw: string, column: StudentColumn): string {
  if (column !== "dob") return raw;
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber) || !/^\d+(\.\d+)?$/.test(raw.trim())) return raw;
  return excelSerialToDate(asNumber) ?? raw;
}

/**
 * Indian school records write dates day-first. 03/04/2015 is 3 April, not
 * 3 March, and getting that backwards puts every child's birthday out by
 * months. ISO input is passed through untouched.
 */
export function parseIndianDate(raw: string): string | null {
  const value = collapse(raw);
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return isoOrNull(+iso[1]!, +iso[2]!, +iso[3]!);

  const dayFirst = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(value);
  if (dayFirst) {
    const year = +dayFirst[3]!;
    return isoOrNull(
      year < 100 ? (year > 40 ? 1900 + year : 2000 + year) : year,
      +dayFirst[2]!,
      +dayFirst[1]!,
    );
  }

  return null;
}

function isoOrNull(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function valueFor(
  row: Record<string, string>,
  mapped: [string, StudentColumn][],
  column: StudentColumn,
): string | null {
  const entry = mapped.find(([, target]) => target === column);
  if (!entry) return null;
  const raw = (row[entry[0]] ?? "").trim();
  if (!raw) return null;
  return COLUMN_BY_KEY.get(column)!.normalise(raw).value;
}

const collapse = (raw: string) => cellToString(raw).replace(/\s+/g, " ").trim();

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
