import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasIdentityColumn,
  matchAskList,
  messageFrom,
  notesFrom,
  TEMPLATE_HEADERS,
} from "../src/lib/ask-list";
import { matchByIdOrSr, indexStudents } from "../src/lib/students-import";
import { student, table } from "./helpers";

/**
 * The office's own list of children, and what it refuses to guess.
 *
 * Pure, no database: matchAskList takes the parsed sheet and the students it
 * might name, which is what lets a test express a whole awkward file as a
 * literal.
 *
 * The assertions worth having are all about the same thing. A list of
 * thirty-five that quietly becomes a round of thirty-one is the worst outcome
 * here — the office believes it asked about everyone, and the four that fell
 * out are the four whose records were already wrong — so every one of these
 * checks that a row which cannot be honoured is NAMED rather than dropped.
 */

const ROLL = [
  student({ id: "S1", srNo: "SR1", name: "Aarav Meena", classLabel: "Class 8" }),
  student({ id: "S2", srNo: "SR2", name: "Priya Sharma", classLabel: "Class 6" }),
  student({ id: "S3", srNo: "SR3", name: "Kiran Bunkar", classLabel: "Class 8" }),
  // Two children sharing one SR number, which really happens after a merge.
  student({ id: "S4", srNo: "DUP", name: "Ravi Gurjar", classLabel: "Class 9" }),
  student({ id: "S5", srNo: "DUP", name: "Suresh Gurjar", classLabel: "Class 9" }),
  student({ id: "S6", srNo: "SR6", name: "Gone Away", classLabel: "Class 7", status: "left" }),
];

describe("hasIdentityColumn", () => {
  it("accepts a sheet with either identifier", () => {
    assert.equal(hasIdentityColumn(["Student ID", "Note to teacher"]), true);
    assert.equal(hasIdentityColumn(["SR No", "Name"]), true);
  });

  it("refuses a sheet carrying only names", () => {
    // Standing rule 7. A name is not a key, and the office has to be told that
    // before it fills in three hundred rows, not after.
    assert.equal(hasIdentityColumn(["Name", "Class", "Note"]), false);
  });
});

describe("matchAskList", () => {
  it("matches on Student ID", () => {
    const result = matchAskList(
      table([{ "Student ID": "S1", "Note to teacher": "Ring the father" }]),
      ROLL,
    );
    assert.equal(result.unmatched.length, 0);
    assert.deepEqual(
      result.matched.map((row) => [row.studentId, row.note]),
      [["S1", "Ring the father"]],
    );
  });

  it("falls back to SR number when there is no ID", () => {
    const result = matchAskList(table([{ "SR No": "SR2" }]), ROLL);
    assert.deepEqual(
      result.matched.map((row) => row.studentId),
      ["S2"],
    );
  });

  it("never matches on name, even when the name is unique and correct", () => {
    // The whole of rule 7 in one assertion. The sheet names a real child, by a
    // name that belongs to exactly one row, and it is still refused.
    const result = matchAskList(table([{ Name: "Aarav Meena" }]), ROLL);
    assert.equal(result.matched.length, 0);
    assert.match(result.unmatched[0]!.reason, /cannot identify/);
  });

  it("refuses an SR number that matches two children rather than picking one", () => {
    const result = matchAskList(table([{ "SR No": "DUP" }]), ROLL);
    assert.equal(result.matched.length, 0);
    assert.match(result.unmatched[0]!.reason, /matches 2 students/);
  });

  it("names a child who has left rather than losing her between two screens", () => {
    /*
     * SHE MATCHES AND IS THEN REFUSED, which is the point. audienceWhere forces
     * status = 'active', so an id that is no longer on the roll would otherwise
     * vanish between this screen and the frozen roster with nothing said — and
     * reporting her as an unknown id would send the office hunting through a
     * spreadsheet for a row that is perfectly correct.
     */
    const result = matchAskList(table([{ "Student ID": "S6" }]), ROLL);
    assert.equal(result.matched.length, 0);
    assert.match(result.unmatched[0]!.reason, /no longer on the active roll/);
  });

  it("reports an unknown id by its row number, so the sheet can be fixed", () => {
    const result = matchAskList(
      table([
        { "Student ID": "S1" },
        { "Student ID": "S999" },
        { "Student ID": "S3" },
      ]),
      ROLL,
    );
    assert.equal(result.matched.length, 2);
    // Row 1 is the header, so the second data row is row 3 — the number Excel
    // itself prints down the left, which is the only one she can act on.
    assert.equal(result.unmatched[0]!.rowNumber, 3);
    assert.match(result.unmatched[0]!.reason, /No student has ID S999/);
  });

  it("takes the same child named twice as a mistake in the sheet", () => {
    const result = matchAskList(
      table([{ "Student ID": "S1" }, { "Student ID": "S1" }]),
      ROLL,
    );
    assert.equal(result.matched.length, 1);
    assert.match(result.unmatched[0]!.reason, /already on an earlier row/);
  });

  it("ignores the blank tail of a spreadsheet", () => {
    // Excel hands back empty rows below the data more often than not, and a
    // round that reported forty "failures" for them would be unusable.
    const result = matchAskList(
      table([{ "Student ID": "S1" }, { "Student ID": "" }, { "Student ID": "" }]),
      ROLL,
    );
    assert.equal(result.matched.length, 1);
    assert.equal(result.unmatched.length, 0);
  });

  it("orders the children the way a register reads, and names the classes", () => {
    const result = matchAskList(
      table([
        { "Student ID": "S3" },
        { "Student ID": "S2" },
        { "Student ID": "S1" },
      ]),
      ROLL,
    );
    assert.deepEqual(
      result.matched.map((row) => row.name),
      ["Priya Sharma", "Aarav Meena", "Kiran Bunkar"],
    );
    assert.deepEqual(result.classLabels, ["Class 6", "Class 8"]);
  });

  it("keeps only the notes that were written", () => {
    const result = matchAskList(
      table([
        { "Student ID": "S1", "Note to teacher": "Not on WhatsApp" },
        { "Student ID": "S2", "Note to teacher": "" },
      ]),
      ROLL,
    );
    assert.deepEqual(notesFrom(result.matched), { S1: "Not on WhatsApp" });
  });
});

describe("messageFrom", () => {
  it("takes the first cell that has anything in it", () => {
    assert.equal(
      messageFrom(table([{ "Message to teachers": "These are not on WhatsApp." }])),
      "These are not on WhatsApp.",
    );
  });

  it("is null for a sheet the office rearranged or left blank", () => {
    // A round without a message is a round; a failed upload is not.
    assert.equal(messageFrom(null), null);
    assert.equal(messageFrom(table([{ "Message to teachers": "" }])), null);
  });
});

/**
 * ONE IMPLEMENTATION OF RULE 7, DRIVEN FROM BOTH DOORS.
 *
 * The importer decides which record to overwrite; this list decides which
 * children a round covers. Different consequences, same question — and a second
 * copy that drifted would not fail a test, it would quietly ask the wrong
 * teacher about the wrong child.
 */
describe("the match rule has one home", () => {
  it("answers a sheet the same way the importer answers it", () => {
    const index = indexStudents(ROLL);

    const direct = matchByIdOrSr(index, { id: "S1", srNo: null });
    const viaList = matchAskList(table([{ "Student ID": "S1" }]), ROLL);
    assert.equal(direct.student?.id, viaList.matched[0]!.studentId);

    const ambiguous = matchByIdOrSr(index, { id: null, srNo: "DUP" });
    const listAmbiguous = matchAskList(table([{ "SR No": "DUP" }]), ROLL);
    assert.equal(ambiguous.ambiguous, listAmbiguous.unmatched[0]!.reason);
  });
});

/**
 * The download and the upload are two halves of one agreement about a file.
 *
 * They drifted the first time they were written: the template's header said
 * "Name (not read)" while the matcher's aliases knew only "name", so the column
 * the office was looking at was invisible to this module — and a row carrying a
 * name and no id was read as the blank tail of the sheet rather than reported.
 * Nothing failed; the row simply was not asked about.
 */
describe("the template's own headers", () => {
  /** Exactly what /api/export/ask-template.xlsx writes as row 1. */
  const templateRow = (over: Partial<Record<string, string>> = {}) => ({
    [TEMPLATE_HEADERS.id]: "",
    [TEMPLATE_HEADERS.srNo]: "",
    [TEMPLATE_HEADERS.name]: "",
    [TEMPLATE_HEADERS.note]: "",
    ...over,
  });

  it("are the ones the matcher reads", () => {
    const result = matchAskList(
      table([
        templateRow({ [TEMPLATE_HEADERS.id]: "S1", [TEMPLATE_HEADERS.note]: "Ring the father" }),
        templateRow({ [TEMPLATE_HEADERS.srNo]: "SR2" }),
      ]),
      ROLL,
    );
    assert.equal(result.unmatched.length, 0);
    assert.deepEqual(
      result.matched.map((row) => row.studentId).sort(),
      ["S1", "S2"],
    );
    assert.deepEqual(notesFrom(result.matched), { S1: "Ring the father" });
  });

  it("let a name-only row be reported rather than read as a blank one", () => {
    const result = matchAskList(
      table([templateRow({ [TEMPLATE_HEADERS.name]: "Aarav Meena" })]),
      ROLL,
    );
    assert.equal(result.matched.length, 0);
    assert.equal(result.unmatched.length, 1, "reported, not silently skipped");
    assert.equal(result.unmatched[0]!.name, "Aarav Meena", "and named, so she can find the row");
  });

  it("carry an identity column, which is what makes the sheet usable", () => {
    assert.equal(hasIdentityColumn(Object.values(TEMPLATE_HEADERS)), true);
  });

  it("name the message cell on its own sheet", () => {
    assert.equal(
      messageFrom(table([{ [TEMPLATE_HEADERS.message]: "Not on WhatsApp." }])),
      "Not on WhatsApp.",
    );
  });
});
