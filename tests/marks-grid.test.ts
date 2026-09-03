import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMarksGrid, type MarkRow } from "../src/lib/marks";

const mark = (studentId: string, fieldKey: string, value: string | null, over: Partial<MarkRow> = {}): MarkRow => ({
  studentId,
  srNo: null,
  name: "X",
  classLabel: "Class 8",
  rollNo: null,
  fieldKey,
  fieldLabel: fieldKey === "fa_maths" ? "FA Maths" : "FA Science",
  sortOrder: fieldKey === "fa_maths" ? 10 : 20,
  value,
  firstEnteredAt: new Date("2026-08-20T00:00:00Z"),
  teacherId: "T1",
  teacherName: "Sunita",
  requestId: "r1",
  ...over,
});

const roster = [
  { id: "S2", name: "BEENA", rollNo: 2 },
  { id: "S1", name: "AARTI", rollNo: 1 },
  { id: "S3", name: "CHETAN", rollNo: null },
];

describe("buildMarksGrid", () => {
  it("leads with the roster, in roll order, and blanks the children with nothing", () => {
    const grid = buildMarksGrid(
      roster,
      [mark("S1", "fa_maths", "18"), mark("S2", "fa_maths", "20"), mark("S2", "fa_science", "22")],
      [
        { key: "fa_maths", label: "FA Maths", outOf: 25, sortOrder: 10 },
        { key: "fa_science", label: "FA Science", outOf: 25, sortOrder: 20 },
      ],
    );
    assert.deepEqual(grid.rows.map((row) => row.studentId), ["S1", "S2", "S3"]);
    assert.deepEqual(grid.rows.map((row) => row.blanks), [1, 0, 2]);
    assert.equal(grid.rows[2]!.marks.fa_maths, null);
  });

  it("averages over the marks entered, not the whole roll", () => {
    const grid = buildMarksGrid(
      roster,
      [mark("S1", "fa_maths", "18"), mark("S2", "fa_maths", "20")],
      [{ key: "fa_maths", label: "FA Maths", outOf: 25, sortOrder: 10 }],
    );
    assert.equal(grid.subjects[0]!.entered, 2);
    assert.equal(grid.subjects[0]!.average, 19);
  });

  it("keeps a mark whose subject was not asked, in a column of its own", () => {
    const grid = buildMarksGrid(roster, [mark("S1", "fa_science", "10")], [
      { key: "fa_maths", label: "FA Maths", outOf: 25, sortOrder: 10 },
    ]);
    assert.deepEqual(grid.subjects.map((subject) => subject.key), ["fa_maths", "fa_science"]);
    assert.equal(grid.subjects[1]!.outOf, null);
  });

  it("treats a non-numeric mark as a blank rather than a crash", () => {
    const grid = buildMarksGrid(roster, [mark("S1", "fa_maths", "AB")], [
      { key: "fa_maths", label: "FA Maths", outOf: 25, sortOrder: 10 },
    ]);
    assert.equal(grid.rows[0]!.marks.fa_maths, null);
    assert.equal(grid.subjects[0]!.average, null);
  });
});
