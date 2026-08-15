import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupRemindersByTeacher } from "../src/lib/reminders";
import type { RequestBoardRow } from "../src/lib/requests";

/**
 * One nudge per teacher, and the two ways that can be silently wrong: folding
 * two different people together, or folding a redirected link back onto a
 * number it was deliberately sent away from.
 */

const TODAY = "2026-08-13";

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
    sentAt: null,
    ...over,
  };
}

describe("groupRemindersByTeacher", () => {
  it("collapses one teacher's several forms into a single nudge", () => {
    const groups = groupRemindersByTeacher(
      [
        row({ id: "R1", audienceLabel: "Class 8" }),
        row({ id: "R2", audienceLabel: "Class 9" }),
        row({ id: "R3", audienceLabel: "Class 10" }),
      ],
      TODAY,
    );

    assert.equal(groups.length, 1, "she would get three WhatsApp messages");
    assert.equal(groups[0]!.forms.length, 3);
  });

  it("keeps two teachers who share a name apart", () => {
    // teachers.id is the key; the name is free text typed by the office, and
    // two Sunita Sharmas in one school is ordinary.
    const groups = groupRemindersByTeacher(
      [
        row({ id: "R1", teacherId: "T1", teacherPhone: "9990000001" }),
        row({ id: "R2", teacherId: "T2", teacherPhone: "9990000004" }),
      ],
      TODAY,
    );

    assert.equal(groups.length, 2, "two people were sent one message between them");
  });

  it("gives a redirected form its own nudge, on the number it was sent to", () => {
    /*
     * She is on leave and her sister is covering that one section, so the
     * office typed a contact_phone for it. Folding it back into her saved-number
     * entry would put it in a message going to the wrong phone — the single
     * failure requests.contact_phone exists to prevent.
     */
    const groups = groupRemindersByTeacher(
      [
        row({ id: "R1", teacherPhone: "9990000001" }),
        row({ id: "R2", teacherPhone: "9998887777", contactPhone: "9998887777" }),
      ],
      TODAY,
    );

    assert.equal(groups.length, 2);
    const redirected = groups.find((g) => g.phone === "9998887777")!;
    assert.ok(redirected, "the override was folded into her saved number");
    assert.equal(redirected.overridden, true, "the board would not say it was redirected");
  });

  it("leaves finished work out — there is nothing to nudge about", () => {
    const groups = groupRemindersByTeacher(
      [
        row({ id: "R1", studentsAnswered: 24, rosterSize: 24 }),
        row({ id: "R2", studentsAnswered: 3, rosterSize: 24 }),
      ],
      TODAY,
    );

    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]!.forms.map((f) => f.requestId), ["R2"]);
  });

  it("ignores anything not open", () => {
    const groups = groupRemindersByTeacher([row({ status: "closed" })], TODAY);
    assert.equal(groups.length, 0);
  });

  it("puts the teachers who are overdue first", () => {
    const groups = groupRemindersByTeacher(
      [
        row({ id: "R1", teacherId: "T1", teacherPhone: "1", dueDate: "2026-09-01" }),
        row({ id: "R2", teacherId: "T2", teacherPhone: "2", dueDate: "2026-08-01" }),
      ],
      TODAY,
    );

    assert.equal(groups[0]!.teacherId, "T2", "the overdue teacher is not at the top");
    assert.equal(groups[0]!.overdue, true);
    assert.equal(groups[1]!.overdue, false);
  });

  it("orders her own forms oldest deadline first", () => {
    // Within one message, what she is latest on should be what she reads first.
    const groups = groupRemindersByTeacher(
      [
        row({ id: "late", dueDate: "2026-09-01" }),
        row({ id: "urgent", dueDate: "2026-08-01" }),
      ],
      TODAY,
    );

    assert.deepEqual(groups[0]!.forms.map((f) => f.requestId), ["urgent", "late"]);
  });

  it("counts the children still outstanding across everything she owes", () => {
    const groups = groupRemindersByTeacher(
      [
        row({ id: "R1", studentsAnswered: 20, rosterSize: 24 }),
        row({ id: "R2", studentsAnswered: 0, rosterSize: 15 }),
      ],
      TODAY,
    );

    assert.equal(groups[0]!.outstanding, 19, "4 + 15");
  });

  it("carries her durable page token through", () => {
    const groups = groupRemindersByTeacher(
      [row({ teacherLinkToken: "abcdefghijklmnop" })],
      TODAY,
    );
    assert.equal(groups[0]!.linkToken, "abcdefghijklmnop");
  });
});
