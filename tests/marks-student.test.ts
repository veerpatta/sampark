import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pivotStudentMarks, type StudentMark } from "../src/lib/marks";

const mark = (over: Partial<StudentMark>): StudentMark => ({
  fieldKey: "fa_maths",
  fieldLabel: "FA Maths",
  sortOrder: 10,
  period: "2026-27/FA1",
  value: "18",
  maxValue: "25",
  ...over,
});

describe("pivotStudentMarks", () => {
  it("is empty for a child with no marks", () => {
    assert.deepEqual(pivotStudentMarks([]), { periods: [], subjects: [] });
  });

  it("reads periods oldest first and subjects in registry order", () => {
    const grid = pivotStudentMarks([
      mark({ period: "2026-27/FA2", value: "20" }),
      mark({ fieldKey: "fa_hindi", fieldLabel: "FA Hindi", sortOrder: 5, value: "12" }),
      mark({}),
    ]);
    assert.deepEqual(grid.periods, ["2026-27/FA1", "2026-27/FA2"]);
    assert.deepEqual(
      grid.subjects.map((subject) => [subject.label, subject.outOf, subject.values]),
      [
        ["FA Hindi", 25, [12, null]],
        ["FA Maths", 25, [18, 20]],
      ],
    );
  });

  it("carries an unknown maximum as null and a non-numeric value as a blank", () => {
    const grid = pivotStudentMarks([mark({ maxValue: null, value: "AB" })]);
    assert.equal(grid.subjects[0]!.outOf, null);
    assert.deepEqual(grid.subjects[0]!.values, [null]);
  });
});
