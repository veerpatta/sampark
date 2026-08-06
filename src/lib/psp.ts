import { normaliseClassLabel } from "./classes";
import { parseIndianDate } from "./students-import";
import type { ParsedTable } from "./excel";

/**
 * The PSP Student Data Entry Report.
 *
 * PSP is the government portal and the official record of WHO A CHILD IS —
 * name, parents, date of birth, gender, category, and the mobile number the
 * school actually rings. It is NOT authoritative for where a child sits: the
 * fee app owns class allocation (see drizzle/seed/sources.ts), and PSP's class
 * names are mapped here only so a disagreement can be reported to the office,
 * never so it can decide one.
 *
 * Four things in this file exist because the real export does something
 * surprising. Each is commented where it happens:
 *   - the primary key is Student NIC ID, because SR No. is NOT unique
 *   - DOB is day-first and a month-first parse is silent and catastrophic
 *   - Aadhaar is masked to four digits and must never reach `aadhaar`
 *   - "Habitation or Locality" is a free-text address, not a village
 */

/* ------------------------------------------------------------ class names */

/**
 * PSP class names -> the fee app's nineteen.
 *
 * PSP spells them "Eight" (not Eighth) and "Twelth" (not Twelfth). Matched
 * exactly as PSP writes them: silently accepting both spellings would hide the
 * day PSP fixes its typo and starts sending something else.
 *
 * USED ONLY TO DETECT DISAGREEMENT. The fee app decides the class.
 */
const PSP_CLASS_NAMES: Record<string, string> = {
  "PP.3+": "Nursery",
  "PP.4+": "JKG",
  "PP.5+": "SKG",
  First: "Class 1",
  Second: "Class 2",
  Third: "Class 3",
  Fourth: "Class 4",
  Fifth: "Class 5",
  Sixth: "Class 6",
  Seventh: "Class 7",
  Eight: "Class 8",
  Ninth: "Class 9",
  Tenth: "Class 10",
};

const PSP_STREAMS: Record<string, string> = {
  Arts: "Arts",
  Commerce: "Commerce",
  Science: "Science",
};

/**
 * What class PSP thinks this child is in, or null when PSP cannot say.
 *
 * 45 of the 84 students in Eleventh and Twelth have Stream = "Not Applicable",
 * so PSP genuinely cannot name their section. Returning null for those is the
 * honest answer and keeps them out of the conflict list — an unknown is not a
 * disagreement.
 */
export function pspClassLabel(
  studyingInClass: string,
  stream: string,
): string | null {
  const raw = normaliseClassLabel(studyingInClass);

  const mapped = PSP_CLASS_NAMES[raw];
  if (mapped) return mapped;

  const year = raw === "Eleventh" ? "11" : raw === "Twelth" ? "12" : null;
  if (!year) return null;

  const section = PSP_STREAMS[normaliseClassLabel(stream)];
  return section ? `${year} ${section}` : null;
}

/* -------------------------------------------------------------- one row */

export type PspRow = {
  /** Student NIC ID — 9 digits, unique across all 504 rows. */
  id: string;
  srNo: string | null;
  name: string;
  fatherName: string | null;
  motherName: string | null;
  dob: string | null;
  gender: string | null;
  category: string | null;
  phone: string | null;
  address: string | null;
  aadhaarLast4: string | null;
  /** What PSP believes; only ever compared against the fee app, never applied. */
  classLabel: string | null;
  rowNumber: number;
  warnings: string[];
};

const cell = (row: Record<string, string>, header: string) =>
  (row[header] ?? "").trim();

const orNull = (value: string) => (value === "" ? null : value);

export function readPspRow(
  row: Record<string, string>,
  rowNumber: number,
): PspRow | { rowNumber: number; error: string } {
  const warnings: string[] = [];

  const id = cell(row, "Student NIC ID");
  if (!id) {
    return {
      rowNumber,
      error: "No Student NIC ID — cannot key this row on anything trustworthy",
    };
  }

  const name = cell(row, "Student Name");
  if (!name) return { rowNumber, error: `No student name for NIC ID ${id}` };

  // DOB IS DAY-FIRST, all 504 of them, e.g. "29/06/2022". parseIndianDate reads
  // it day-first deliberately: hand "01/10/2022" to new Date() and it becomes
  // 10 January, every child's birthday moves by months, and nobody notices for
  // a year.
  const rawDob = cell(row, "DOB");
  const dob = rawDob ? parseIndianDate(rawDob) : null;
  if (rawDob && !dob) warnings.push(`DOB "${rawDob}" is not a date — skipped`);

  // AADHAAR IS MASKED. 328 rows carry exactly four digits, 176 are empty, and
  // there is not one full 12-digit number in the file. It goes nowhere near
  // `aadhaar`, whose exactLen is 12 — a 4-digit suffix sitting there would look
  // like real data and fail validation forever after.
  const rawAadhaar = cell(row, "Aadhar Number").replace(/\D/g, "");
  let aadhaarLast4: string | null = null;
  if (rawAadhaar.length === 4) {
    aadhaarLast4 = rawAadhaar;
  } else if (rawAadhaar.length === 12) {
    // Has not happened in any file so far. If PSP ever stops masking, this
    // should be noticed and handled deliberately, not silently truncated.
    warnings.push(
      `Aadhaar for NIC ID ${id} is a full 12 digits, which PSP has never sent before — parked in aadhaar_last4 as its last four; check before trusting it`,
    );
    aadhaarLast4 = rawAadhaar.slice(-4);
  } else if (rawAadhaar.length > 0) {
    warnings.push(`Aadhaar "${rawAadhaar}" is neither 4 nor 12 digits — skipped`);
  }

  const phone = cell(row, "Mobile Number").replace(/\D/g, "");
  if (phone && phone.length !== 10) {
    warnings.push(`Mobile number "${phone}" is not 10 digits — skipped`);
  }

  return {
    id,
    srNo: orNull(cell(row, "SR No.")),
    name,
    fatherName: orNull(cell(row, "Father Name")),
    motherName: orNull(cell(row, "Mother Name")),
    dob,
    gender: orNull(cell(row, "Gender")),
    category: orNull(cell(row, "Social Category").toUpperCase()),
    phone: phone.length === 10 ? phone : null,
    // "Habitation or Locality" is free text — "WARD NO 07 AMET", "jato ki pol
    // amet", sometimes with a PIN code. It is an address, not a village, and no
    // amount of parsing turns one into the other. `village` stays a collect
    // field for a teacher to answer.
    address: orNull(cell(row, "Habitation or Locality")),
    aadhaarLast4,
    classLabel: pspClassLabel(
      cell(row, "Studying in Class"),
      cell(row, "Stream (Grades 11 & 12)"),
    ),
    rowNumber,
    warnings,
  };
}

export type PspReadResult = {
  rows: PspRow[];
  errors: { rowNumber: number; error: string }[];
  /**
   * SR numbers that more than one NIC ID claims. Three of these are real in the
   * school's own records — two different children, born five years apart,
   * sharing an SR number. Matching on SR would silently merge them.
   */
  duplicateSrNos: Map<string, string[]>;
};

export function readPspTable(table: ParsedTable): PspReadResult {
  const rows: PspRow[] = [];
  const errors: { rowNumber: number; error: string }[] = [];

  table.rows.forEach((raw, index) => {
    const result = readPspRow(raw, index + 2);
    if ("error" in result) errors.push(result);
    else rows.push(result);
  });

  const bySr = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.srNo) continue;
    bySr.set(row.srNo, [...(bySr.get(row.srNo) ?? []), row.id]);
  }

  return {
    rows,
    errors,
    duplicateSrNos: new Map(
      [...bySr.entries()].filter(([, ids]) => ids.length > 1),
    ),
  };
}
