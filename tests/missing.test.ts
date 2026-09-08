import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingFromRoster } from "../src/lib/requests";

/**
 * Roster minus the children already answered for.
 *
 * This is the subtraction from `coveredStudentsQuery`, and it was extracted so
 * there is exactly one of it. There is one definition of "answered" in
 * lib/answered.ts precisely because five places had written their own and one
 * disagreed; a second loop that undoes it by hand is the same bug wearing a
 * different hat.
 */

const roster = (rows: [string, number | null, string][]) =>
  rows.map(([studentId, rollNo, name]) => ({
    studentId,
    rollNo,
    snapshot: { name },
  }));

describe("missingFromRoster", () => {
  it("drops the children who are covered", () => {
    const out = missingFromRoster(
      roster([
        ["S1", 1, "Aarav"],
        ["S2", 2, "Bhavna"],
        ["S3", 3, "Chetan"],
      ]),
      new Set(["S2"]),
      "roll",
    );
    assert.deepEqual(
      out.map((child) => child.studentId),
      ["S1", "S3"],
    );
  });

  it("returns nobody when the whole roster is covered", () => {
    const out = missingFromRoster(
      roster([
        ["S1", 1, "Aarav"],
        ["S2", 2, "Bhavna"],
      ]),
      new Set(["S1", "S2"]),
      "roll",
    );
    assert.deepEqual(out, []);
  });

  it("returns nobody for an empty roster", () => {
    // A group with nobody in it is not a group that is finished — but it has
    // nobody outstanding either, and isAnsweredFully is where that distinction
    // is drawn.
    assert.deepEqual(missingFromRoster([], new Set(), "roll"), []);
  });

  it("takes the name off the frozen snapshot, never off master", () => {
    // This list is about what the teacher was actually sent. A child renamed
    // in master since the link went out must still read as the name on her
    // screen.
    const out = missingFromRoster(
      [{ studentId: "S1", rollNo: 1, snapshot: { name: "As sent" } }],
      new Set(),
      "roll",
    );
    assert.equal(out[0]!.name, "As sent");
  });

  it("falls back to the student id when the snapshot carries no name", () => {
    const out = missingFromRoster(
      [{ studentId: "S1", rollNo: null, snapshot: {} }],
      new Set(),
      "roll",
    );
    assert.equal(out[0]!.name, "S1");
  });

  it("sorts by roll number, with no-roll children LAST", () => {
    // A null roll is "we do not know where she is in the register", which is
    // not the same claim as "she is number zero" — and sorting her first would
    // put her above a child the teacher can actually find.
    const out = missingFromRoster(
      roster([
        ["S1", null, "Zara"],
        ["S2", 9, "Bhavna"],
        ["S3", 2, "Aarav"],
      ]),
      new Set(),
      "roll",
    );
    assert.deepEqual(
      out.map((child) => child.studentId),
      ["S3", "S2", "S1"],
    );
  });

  it("falls back to name order among children with no roll number", () => {
    // On the real roster almost nobody has a roll number, so this is the
    // ordinary case rather than a tie-break.
    const out = missingFromRoster(
      roster([
        ["S1", null, "CHETAN"],
        ["S2", null, "Aarav"],
        ["S3", null, "bhavna"],
      ]),
      new Set(),
      "roll",
    );
    assert.deepEqual(
      out.map((child) => child.name),
      ["Aarav", "bhavna", "CHETAN"],
    );
  });

  it("sorts by name alone when asked, which is what /requests/[id] shows", () => {
    const out = missingFromRoster(
      roster([
        ["S1", 1, "Zara"],
        ["S2", 9, "Aarav"],
      ]),
      new Set(),
      "name",
    );
    assert.deepEqual(
      out.map((child) => child.name),
      ["Aarav", "Zara"],
    );
  });

  it("keys on whatever the caller says, so one child can span two links", () => {
    // A house round and a class round overlap by construction. A set of bare
    // student ids would mark her answered everywhere the moment she answered
    // anywhere, which is how a class quietly reports itself finished.
    const rows = [
      { requestId: "R1", studentId: "S1", rollNo: 1, snapshot: { name: "Aarav" } },
      { requestId: "R2", studentId: "S1", rollNo: 1, snapshot: { name: "Aarav" } },
    ];
    const out = missingFromRoster(
      rows,
      new Set(["R1|S1"]),
      "roll",
      (row) => `${row.requestId}|${row.studentId}`,
    );
    assert.equal(out.length, 1, "she is still outstanding on the other link");
  });
});
