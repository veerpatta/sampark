import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { student } from "./helpers";
import {
  DELIBERATELY_ABSENT,
  STUDENT_COLUMNS,
  studentExportColumns,
} from "../src/lib/student-export";
import { suggestColumnMap } from "../src/lib/students-import";
import { STUDENT_COLUMN_BY_DB_NAME } from "../src/lib/student-columns";
import type { Student } from "../drizzle/schema";

/**
 * "The export should contain everything that is on the app."
 *
 * IT DID NOT, AND NOTHING NOTICED. `house` was added to the schema, collected
 * by teachers, drawn as a chip on the board and on every child's page — and
 * left out of the workbook, out of the "What we hold" card and out of the
 * import mapper, because all three read a list that was written by hand and
 * never re-read. The office could collect a house and never get it back.
 *
 * So the rule is enforced rather than remembered. These tests read the LIVE
 * schema: a column added to `students` fails them until it is either given a
 * column in the export or written into DELIBERATELY_ABSENT with a reason.
 */

/** One child with a distinct, recognisable value in every single column. */
const FILLED: Student = student({
  id: "ZZid",
  srNo: "ZZsrNo",
  admissionNo: "ZZadmissionNo",
  classLabel: "Class 8",
  section: "ZZsection",
  rollNo: 4242,
  name: "ZZname",
  fatherName: "ZZfatherName",
  motherName: "ZZmotherName",
  phone: "9000000001",
  altPhone: "9000000002",
  dob: "2011-03-07",
  gender: "ZZgender",
  category: "ZZcategory",
  aadhaar: "111122223333",
  janAadhaar: "ZZjanAadhaar",
  village: "ZZvillage",
  address: "ZZaddress",
  busRoute: "ZZbusRoute",
  house: "Rana Sanga",
  aadhaarLast4: "4321",
  photoPath: "students/ZZid/20260819-0123456789abcdef01234567.jpg",
  status: "left",
  source: "ZZsource",
  createdAt: new Date("2024-01-02T18:30:00Z"),
  updatedAt: new Date("2025-06-11T18:30:00Z"),
});

/** What each column should look like once the workbook has rendered it. */
const EXPECTED: Record<string, string> = {
  id: "ZZid",
  sr_no: "ZZsrNo",
  admission_no: "ZZadmissionNo",
  class_label: "Class 8",
  section: "ZZsection",
  roll_no: "4242",
  name: "ZZname",
  father_name: "ZZfatherName",
  mother_name: "ZZmotherName",
  phone: "9000000001",
  alt_phone: "9000000002",
  dob: "2011-03-07",
  gender: "ZZgender",
  category: "ZZcategory",
  aadhaar: "111122223333",
  jan_aadhaar: "ZZjanAadhaar",
  village: "ZZvillage",
  address: "ZZaddress",
  bus_route: "ZZbusRoute",
  house: "Rana Sanga",
  aadhaar_last4: "4321",
  status: "left",
  source: "ZZsource",
  // IST, so an 18:30Z stamp is already the next day at school.
  created_at: "2024-01-03",
  updated_at: "2025-06-12",
};

const rendered = () => {
  const columns = studentExportColumns(new Map());
  return columns.map((column) => String(column.value(FILLED) ?? ""));
};

describe("the students export carries every column", () => {
  test("no students column is silently left out", () => {
    const values = rendered();
    const missing: string[] = [];

    for (const column of STUDENT_COLUMNS) {
      const property = STUDENT_COLUMN_BY_DB_NAME.get(column) ?? column;
      if (DELIBERATELY_ABSENT[property as keyof Student]) continue;

      const expected = EXPECTED[column];
      assert.ok(
        expected !== undefined,
        `${column} is a students column with no expected value in this test — ` +
          `add it to EXPECTED (and to the export) or to DELIBERATELY_ABSENT`,
      );
      if (!values.some((value) => value === expected)) missing.push(column);
    }

    assert.deepEqual(
      missing,
      [],
      `these columns are in the database and not in the workbook: ${missing.join(", ")}`,
    );
  });

  test("house is in the file — the column this was all about", () => {
    assert.ok(
      rendered().includes("Rana Sanga"),
      "a house the school collected must come back out of the export",
    );
  });

  test("the photograph is a picture, not its blob pathname", () => {
    const values = rendered();
    assert.ok(
      !values.some((value) => value.startsWith("students/")),
      "a blob pathname leaked into a cell — it is an internal identifier",
    );
    const photo = studentExportColumns(new Map()).find((c) => c.header === "Photo");
    assert.ok(photo?.image, "the Photo column stopped drawing an image");
  });

  test("a child with nothing on record still produces every cell", () => {
    // Guards the other direction: a `value` that threw on a null would take the
    // whole export down for one empty column, and most of these are null for
    // most children.
    const empty = student({ id: "ZZempty" });
    for (const column of studentExportColumns(new Map())) {
      assert.doesNotThrow(
        () => column.value(empty),
        `the ${column.header} column threw on a child with nothing in it`,
      );
    }
  });
});

/**
 * The round trip the file's own header promises: export, correct it in Excel,
 * import it again. The importer matches on header NAME, so renaming a header
 * here quietly breaks that — with no error, just a column the office maps by
 * hand for ever after.
 */
describe("every exported header can be read back on import", () => {
  /** Headers that carry no importable value, and why. */
  const NOT_IMPORTABLE = new Set([
    "Photo", // a picture; its pathname is deliberately not in the file
    "Source", // provenance, written by the importer itself
    "Added On",
    "Last Updated",
  ]);

  test("suggestColumnMap recognises every column header", () => {
    const headers = studentExportColumns(new Map()).map((c) => c.header);
    const map = suggestColumnMap(headers);
    const unmapped = headers.filter(
      (header) => !NOT_IMPORTABLE.has(header) && !map[header],
    );
    assert.deepEqual(
      unmapped,
      [],
      `these headers would not map back on re-import: ${unmapped.join(", ")}`,
    );
  });

  test("nothing importable is hiding in the not-importable list", () => {
    // Keeps the escape hatch honest: if a header on that list DOES map, it
    // should not be on it.
    const map = suggestColumnMap([...NOT_IMPORTABLE]);
    assert.deepEqual(Object.keys(map), []);
  });
});
