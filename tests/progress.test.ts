import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyForm,
  groupProgressByTeacher,
} from "../src/lib/progress";
import type { RequestBoardRow } from "../src/lib/requests";

/**
 * How far each teacher has got.
 *
 * The rule that matters most here is the one that separates this file from
 * lib/reminders.ts: a reminder DROPS finished work, and a progress board must
 * not. A teacher who has done everything has to be visible as done, because
 * absent from the board reads exactly like nobody asked her.
 */

const TODAY = "2026-08-13";
const MARKS = new Set(["fa_maths", "fa_science"]);

function row(over: Partial<RequestBoardRow> = {}): RequestBoardRow {
  return {
    id: "R1",
    title: "FA1 marks",
    audienceLabel: "Class 8",
    audienceKind: "class",
    teacher: "Sunita Sharma",
    teacherId: "T1",
    dueDate: "2026-08-20",
    status: "open",
    token: "tok1",
    teacherPhone: "9990000001",
    contactPhone: null,
    fieldKeys: ["fa_maths"],
    teacherLinkToken: null,
    rosterSize: 24,
    studentsAnswered: 0,
    changesPending: 0,
    archivedAt: null,
    batchId: null,
    createdAt: new Date("2026-08-10T04:00:00Z"),
    sentAt: new Date("2026-08-10T05:00:00Z"),
    ...over,
  };
}

describe("classifyForm", () => {
  it("reads marks off the registry set, never off the key's spelling", () => {
    // Rule 11: a seventeenth subject is a field_defs row, not a deploy. If this
    // ever matched /^fa_/ instead, a subject added at Settings -> Fields with
    // any other key would silently count as student data.
    assert.equal(classifyForm(["fa_maths"], MARKS), "marks");
    assert.equal(classifyForm(["music_marks"], new Set(["music_marks"])), "marks");
  });

  it("calls a link with no marks fields details", () => {
    assert.equal(classifyForm(["phone", "village"], MARKS), "details");
  });

  it("calls a link carrying both mixed, and does not pick a side", () => {
    // Coverage is per student across the WHOLE field set, so this link has one
    // number that covers both kinds. Counting it into both buckets would report
    // the same work twice and double the denominator.
    assert.equal(classifyForm(["fa_maths", "phone"], MARKS), "mixed");
  });
});

describe("groupProgressByTeacher", () => {
  it("KEEPS a teacher who has finished everything", () => {
    // The whole reason this is not groupRemindersByTeacher. She is done, and a
    // board that omitted her would be indistinguishable from one where nobody
    // had asked her for anything.
    const groups = groupProgressByTeacher(
      [row({ studentsAnswered: 24, rosterSize: 24 })],
      MARKS,
      TODAY,
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.forms[0]!.done, true);
    assert.equal(groups[0]!.outstanding, 0);
  });

  it("collapses one teacher's several links into one entry", () => {
    const groups = groupProgressByTeacher(
      [
        row({ id: "R1", audienceLabel: "Class 8" }),
        row({ id: "R2", audienceLabel: "Class 9" }),
        row({ id: "R3", audienceLabel: "Class 10" }),
      ],
      MARKS,
      TODAY,
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.forms.length, 3);
  });

  it("keeps two teachers who share a name apart", () => {
    const groups = groupProgressByTeacher(
      [
        row({ id: "R1", teacherId: "T1", teacherPhone: "9990000001" }),
        row({ id: "R2", teacherId: "T2", teacherPhone: "9990000002" }),
      ],
      MARKS,
      TODAY,
    );
    assert.equal(groups.length, 2);
  });

  it("splits a link redirected to a covering teacher's number", () => {
    // contact_phone exists to send ONE link somewhere else. Folding it back
    // into her saved-number entry would put it in a message to the wrong phone.
    const groups = groupProgressByTeacher(
      [
        row({ id: "R1" }),
        row({ id: "R2", contactPhone: "9995550000", teacherPhone: "9995550000" }),
      ],
      MARKS,
      TODAY,
    );

    assert.equal(groups.length, 2);
    assert.equal(groups.filter((entry) => entry.overridden).length, 1);
  });

  it("counts marks and details into separate buckets", () => {
    const [teacher] = groupProgressByTeacher(
      [
        row({ id: "R1", fieldKeys: ["fa_maths"], rosterSize: 24, studentsAnswered: 19 }),
        row({ id: "R2", fieldKeys: ["phone"], rosterSize: 46, studentsAnswered: 40 }),
      ],
      MARKS,
      TODAY,
    );

    assert.equal(teacher!.marks.students, 24);
    assert.equal(teacher!.marks.answered, 19);
    assert.equal(teacher!.details.students, 46);
    assert.equal(teacher!.details.answered, 40);
    // Never merged: 63 of 70 would describe neither piece of work.
    assert.equal(teacher!.outstanding, 5 + 6);
  });

  it("puts a link carrying both kinds in its own bucket, not in both", () => {
    const [teacher] = groupProgressByTeacher(
      [row({ fieldKeys: ["fa_maths", "phone"], rosterSize: 24, studentsAnswered: 4 })],
      MARKS,
      TODAY,
    );

    assert.equal(teacher!.mixed.students, 24);
    assert.equal(teacher!.marks.students, 0);
    assert.equal(teacher!.details.students, 0);
    assert.equal(teacher!.outstanding, 20, "counted once, not twice");
  });

  it("does not call a finished link overdue", () => {
    // A link she COMPLETED last week is not something anyone is late on, and
    // letting it set the flag sorts her to the top of a chase list she has no
    // business being on.
    const [teacher] = groupProgressByTeacher(
      [row({ dueDate: "2026-08-01", rosterSize: 24, studentsAnswered: 24 })],
      MARKS,
      TODAY,
    );

    assert.equal(teacher!.forms[0]!.overdue, false);
    assert.equal(teacher!.overdue, false);
  });

  it("does call an unfinished past-due link overdue", () => {
    const [teacher] = groupProgressByTeacher(
      [row({ dueDate: "2026-08-01", rosterSize: 24, studentsAnswered: 3 })],
      MARKS,
      TODAY,
    );
    assert.equal(teacher!.overdue, true);
  });

  it("distinguishes a link nobody sent from a teacher who has not started", () => {
    // Both read 0 of 24. Only one of them is her fault, and a board that says
    // "not started" about the other is an accusation the data does not support.
    const [teacher] = groupProgressByTeacher(
      [row({ id: "R1", sentAt: null }), row({ id: "R2", sentAt: new Date() })],
      MARKS,
      TODAY,
    );

    const byId = new Map(teacher!.forms.map((form) => [form.requestId, form]));
    assert.equal(byId.get("R1")!.sent, false);
    assert.equal(byId.get("R2")!.sent, true);
  });

  it("never reads an empty roster as complete", () => {
    // 0 >= 0 is true, and a group with nobody in it reported as a finished
    // round would sort to the bottom and never be looked at again.
    const [teacher] = groupProgressByTeacher(
      [row({ rosterSize: 0, studentsAnswered: 0 })],
      MARKS,
      TODAY,
    );
    assert.equal(teacher!.forms[0]!.done, false);
  });

  it("leaves closed links out", () => {
    assert.deepEqual(
      groupProgressByTeacher([row({ status: "closed" })], MARKS, TODAY),
      [],
    );
  });

  it("sorts overdue first, then whoever holds up the most children", () => {
    const groups = groupProgressByTeacher(
      [
        row({ id: "R1", teacherId: "T1", teacherPhone: "1", teacher: "Anita", studentsAnswered: 20 }),
        row({ id: "R2", teacherId: "T2", teacherPhone: "2", teacher: "Bina", studentsAnswered: 0 }),
        row({ id: "R3", teacherId: "T3", teacherPhone: "3", teacher: "Chetna", dueDate: "2026-08-01" }),
      ],
      MARKS,
      TODAY,
    );

    assert.deepEqual(
      groups.map((entry) => entry.teacherName),
      ["Chetna", "Bina", "Anita"],
    );
  });

  it("totals what the office still owes her a decision on", () => {
    const [teacher] = groupProgressByTeacher(
      [row({ id: "R1", changesPending: 4 }), row({ id: "R2", changesPending: 3 })],
      MARKS,
      TODAY,
    );
    assert.equal(teacher!.changesPending, 7);
  });
});
