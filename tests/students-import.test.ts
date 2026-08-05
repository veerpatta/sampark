import { student, table } from "./helpers";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseIndianDate,
  planRows,
  suggestColumnMap,
  type ColumnMap,
} from "../src/lib/students-import";

/**
 * Rule 7 is the one this file exists for: match on student ID first, then SR
 * number, NEVER on name; a blank cell means "no change", never "erase".
 *
 * A bug here silently rewrites the master record with the wrong child's data,
 * and nothing downstream would catch it — the review queue only sees teacher
 * submissions, not imports.
 */

const MAP: ColumnMap = {
  "Student ID": "id",
  "SR No": "srNo",
  Class: "classLabel",
  Name: "name",
  Mobile: "phone",
  "Father Name": "fatherName",
};

const byRow = (plan: ReturnType<typeof planRows>, rowNumber: number) =>
  plan.rows.find((row) => row.rowNumber === rowNumber)!;

describe("matching", () => {
  test("matches on student ID and updates only what differs", () => {
    const plan = planRows(
      table([
        { "Student ID": "S1001", "SR No": "", Class: "6", Name: "Aarav", Mobile: "9812345670", "Father Name": "Ramesh" },
      ]),
      MAP,
      [student({ id: "S1001", name: "Aarav", classLabel: "6", phone: "9800000000", fatherName: "Ramesh" })],
    );

    const row = byRow(plan, 2);
    assert.equal(row.outcome, "update");
    assert.equal(row.matchedBy, "id");
    assert.deepEqual(Object.keys(row.changes), ["phone"]);
    assert.deepEqual(row.changes.phone, { from: "9800000000", to: "9812345670" });
  });

  test("falls back to SR number when there is no student ID", () => {
    const plan = planRows(
      table([{ "Student ID": "", "SR No": "SR-77", Class: "6", Name: "Aarav", Mobile: "9812345670", "Father Name": "" }]),
      MAP,
      [student({ id: "S1001", srNo: "SR-77", name: "Aarav" })],
    );

    const row = byRow(plan, 2);
    assert.equal(row.outcome, "update");
    assert.equal(row.matchedBy, "sr_no");
    assert.equal(row.studentId, "S1001");
  });

  test("NEVER matches on name", () => {
    // Same name, same class, different ID. This must create a second record,
    // not overwrite the first one.
    const plan = planRows(
      table([{ "Student ID": "S2002", "SR No": "", Class: "6", Name: "Aarav", Mobile: "9812345670", "Father Name": "" }]),
      MAP,
      [student({ id: "S1001", name: "Aarav", classLabel: "6", phone: "9800000000" })],
    );

    const row = byRow(plan, 2);
    assert.equal(row.outcome, "insert");
    assert.equal(row.matchedBy, null);
    assert.equal(row.studentId, "S2002");
  });

  test("an ambiguous SR number is an error, not a guess", () => {
    const plan = planRows(
      table([{ "Student ID": "", "SR No": "SR-77", Class: "6", Name: "Aarav", Mobile: "9812345670", "Father Name": "" }]),
      MAP,
      [
        student({ id: "S1001", srNo: "SR-77" }),
        student({ id: "S1002", srNo: "SR-77" }),
      ],
    );

    const row = byRow(plan, 2);
    assert.equal(row.outcome, "error");
    assert.match(row.message!, /matches 2 students/);
    assert.equal(plan.writes[0]!.write, undefined);
  });

  test("flags an ID that appears twice in one file", () => {
    const plan = planRows(
      table([
        { "Student ID": "S1001", "SR No": "", Class: "6", Name: "Aarav", Mobile: "9812345670", "Father Name": "" },
        { "Student ID": "S1001", "SR No": "", Class: "6", Name: "Aarav", Mobile: "9812345671", "Father Name": "" },
      ]),
      MAP,
      [student({ id: "S1001" })],
    );

    assert.ok(
      byRow(plan, 3).warnings.some((warning) => /more than once/.test(warning)),
    );
  });
});

describe("blank cells", () => {
  test("a blank cell means no change, never erase", () => {
    const plan = planRows(
      table([{ "Student ID": "S1001", "SR No": "", Class: "", Name: "", Mobile: "9812345670", "Father Name": "" }]),
      MAP,
      [
        student({
          id: "S1001",
          name: "Aarav",
          classLabel: "6",
          fatherName: "Ramesh",
          phone: "9800000000",
        }),
      ],
    );

    const row = byRow(plan, 2);
    assert.deepEqual(Object.keys(row.changes), ["phone"]);

    const write = plan.writes[0]!.write as { values: Record<string, unknown> };
    assert.deepEqual(Object.keys(write.values), ["phone"]);
    assert.equal("fatherName" in write.values, false);
    assert.equal("name" in write.values, false);
  });

  test("a row that changes nothing is skipped, not written", () => {
    const plan = planRows(
      table([{ "Student ID": "S1001", "SR No": "", Class: "6", Name: "Aarav", Mobile: "9800000000", "Father Name": "" }]),
      MAP,
      [student({ id: "S1001", name: "Aarav", classLabel: "6", phone: "9800000000" })],
    );

    assert.equal(byRow(plan, 2).outcome, "skip");
    assert.equal(plan.counts.skip, 1);
    assert.equal(plan.writes[0]!.write, undefined);
  });
});

describe("new students", () => {
  test("name plus class is a valid row", () => {
    const plan = planRows(
      table([{ "Student ID": "", "SR No": "", Class: "7", Name: "Meera", Mobile: "", "Father Name": "" }]),
      MAP,
      [],
    );

    const row = byRow(plan, 2);
    assert.equal(row.outcome, "insert");
    assert.match(row.studentId!, /^TMP-[0-9A-F]{8}$/);
    assert.ok(row.warnings.some((warning) => /create a second one/.test(warning)));
  });

  test("no name is an error", () => {
    const plan = planRows(
      table([{ "Student ID": "", "SR No": "", Class: "7", Name: "", Mobile: "9812345670", "Father Name": "" }]),
      MAP,
      [],
    );
    assert.equal(byRow(plan, 2).outcome, "error");
  });

  test("no class is an error", () => {
    const plan = planRows(
      table([{ "Student ID": "", "SR No": "", Class: "", Name: "Meera", Mobile: "", "Father Name": "" }]),
      MAP,
      [],
    );
    assert.equal(byRow(plan, 2).outcome, "error");
  });

  test("a missing SR number is a warning, not a blocker", () => {
    const plan = planRows(
      table([{ "Student ID": "S3003", "SR No": "", Class: "7", Name: "Meera", Mobile: "", "Father Name": "" }]),
      MAP,
      [],
    );
    assert.equal(byRow(plan, 2).outcome, "insert");
    assert.equal(plan.counts.error, 0);
  });
});

describe("cell validation", () => {
  test("a bad phone number is dropped with a warning; the rest of the row imports", () => {
    const plan = planRows(
      table([{ "Student ID": "S1001", "SR No": "", Class: "6", Name: "Aarav", Mobile: "98123", "Father Name": "Ramesh" }]),
      MAP,
      [student({ id: "S1001", name: "Aarav", classLabel: "6" })],
    );

    const row = byRow(plan, 2);
    assert.equal(row.outcome, "update");
    assert.equal("phone" in row.changes, false);
    assert.deepEqual(Object.keys(row.changes), ["fatherName"]);
    assert.ok(row.warnings.some((warning) => /not 10 digits/.test(warning)));
  });

  test("strips a 91 country code rather than rejecting the number", () => {
    const plan = planRows(
      table([{ "Student ID": "S1001", "SR No": "", Class: "6", Name: "Aarav", Mobile: "919812345670", "Father Name": "" }]),
      MAP,
      [student({ id: "S1001" })],
    );
    assert.deepEqual(byRow(plan, 2).changes.phone, {
      from: null,
      to: "9812345670",
    });
  });
});

describe("parseIndianDate", () => {
  test("reads slash dates day-first", () => {
    // 3 April, not 3 March. Getting this backwards moves every birthday.
    assert.equal(parseIndianDate("03/04/2015"), "2015-04-03");
    assert.equal(parseIndianDate("31-12-2014"), "2014-12-31");
  });

  test("passes ISO through", () => {
    assert.equal(parseIndianDate("2015-04-03"), "2015-04-03");
  });

  test("rejects an impossible date rather than rolling it over", () => {
    assert.equal(parseIndianDate("31/02/2015"), null);
    assert.equal(parseIndianDate("not a date"), null);
    assert.equal(parseIndianDate(""), null);
  });
});

describe("suggestColumnMap", () => {
  test("recognises common PSP header spellings", () => {
    const map = suggestColumnMap([
      "Student ID",
      "SR No",
      "Student Name",
      "Father's Name",
      "Mobile No",
      "Class",
      "Something We Do Not Know",
    ]);

    assert.equal(map["Student ID"], "id");
    assert.equal(map["SR No"], "srNo");
    assert.equal(map["Student Name"], "name");
    assert.equal(map["Father's Name"], "fatherName");
    assert.equal(map["Mobile No"], "phone");
    assert.equal(map.Class, "classLabel");
    assert.equal(map["Something We Do Not Know"], undefined);
  });

  test("never maps two headers to the same column", () => {
    const map = suggestColumnMap(["Mobile", "Mobile No", "Phone"]);
    const targets = Object.values(map).filter(Boolean);
    assert.equal(new Set(targets).size, targets.length);
  });
});
