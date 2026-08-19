import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarise } from "../src/components/teacher/summary";
import type {
  RowState,
  TeacherField,
  TeacherRosterRow,
} from "../src/components/teacher/types";

const PHONE: TeacherField = {
  key: "phone",
  labelEn: "Mobile",
  labelHi: "मोबाइल नंबर",
  mode: "verify",
  inputType: "tel",
  exactLen: 10,
  pattern: null,
  maxValue: null,
  options: null,
  targetColumn: "phone",
};

const FATHER: TeacherField = {
  ...PHONE,
  key: "father_name",
  labelEn: "Father",
  labelHi: "पिता का नाम",
  inputType: "text",
  exactLen: null,
  targetColumn: "father_name",
};

function student(
  id: string,
  name: string,
  values: Record<string, string | null> = {},
): TeacherRosterRow {
  return {
    studentId: id,
    srNo: null,
    name,
    route: null,
    house: null,
    classLabel: null,
    fatherName: null,
    siblingPhone: null,
    values,
    answered: {},
    notPresent: false,
  };
}

const row = (status: RowState["status"], values: Record<string, string> = {}): RowState => ({
  status,
  values,
});

describe("summarise", () => {
  it("reports a corrected value as old to new", () => {
    const roster = [student("s1", "Ravi", { phone: "9876543210" })];
    const result = summarise(roster, [PHONE], {
      s1: row("edited", { phone: "9000000001" }),
    });

    assert.equal(result.changed.length, 1);
    assert.deepEqual(
      { from: result.changed[0]!.from, to: result.changed[0]!.to },
      { from: "9876543210", to: "9000000001" },
    );
    assert.equal(result.confirmed.length, 0);
  });

  it("reports a first-ever value with a null old side, not an empty string", () => {
    // The screen has to be able to say "nothing held" rather than showing a
    // blank arrow that reads as a value being erased.
    const roster = [student("s1", "Ravi", { phone: null })];
    const result = summarise(roster, [PHONE], {
      s1: row("edited", { phone: "9000000001" }),
    });

    assert.equal(result.changed[0]!.from, null);
  });

  it("counts a confirmation as confirmed, not as a change", () => {
    const roster = [student("s1", "Ravi", { phone: "9876543210" })];
    const result = summarise(roster, [PHONE], { s1: row("confirmed") });

    assert.equal(result.changed.length, 0);
    assert.deepEqual(result.confirmed, [{ studentId: "s1", name: "Ravi" }]);
  });

  it("treats retyping the same value as a confirmation, not a change", () => {
    // She sometimes opens the field, types what is already there, and taps
    // done. Showing her "9876543210 -> 9876543210" would make her check
    // something that has not moved.
    const roster = [student("s1", "Ravi", { phone: "9876543210" })];
    const result = summarise(roster, [PHONE], {
      s1: row("edited", { phone: "9876543210" }),
    });

    assert.equal(result.changed.length, 0);
    assert.equal(result.confirmed.length, 1);
  });

  it("lists not-in-this-class separately", () => {
    const roster = [student("s1", "Ravi")];
    const result = summarise(roster, [PHONE], { s1: row("absent") });

    assert.deepEqual(result.notPresent, [{ studentId: "s1", name: "Ravi" }]);
    assert.equal(result.confirmed.length, 0);
  });

  it("counts an untouched row as unanswered", () => {
    const roster = [student("s1", "Ravi")];
    const result = summarise(roster, [PHONE], { s1: row("todo") });

    assert.deepEqual(result.untouched, [{ studentId: "s1", name: "Ravi" }]);
  });

  it("counts a row left mid-edit as unanswered, not as done", () => {
    // A half-typed number is not an answer. This is the same rule the progress
    // rail already applies, and the summary must not disagree with it.
    const roster = [student("s1", "Ravi")];
    const result = summarise(roster, [PHONE], {
      s1: row("editing", { phone: "98765" }),
    });

    assert.deepEqual(result.untouched, [{ studentId: "s1", name: "Ravi" }]);
    assert.equal(result.changed.length, 0);
  });

  it("counts a missing row as unanswered rather than throwing", () => {
    const roster = [student("s1", "Ravi")];
    const result = summarise(roster, [PHONE], {});

    assert.equal(result.untouched.length, 1);
  });

  it("lists one entry per changed field for the same student", () => {
    const roster = [
      student("s1", "Ravi", { phone: "9876543210", father_name: "Mohan" }),
    ];
    const result = summarise(roster, [PHONE, FATHER], {
      s1: row("edited", { phone: "9000000001", father_name: "Mohan Lal" }),
    });

    assert.equal(result.changed.length, 2);
    assert.deepEqual(
      result.changed.map((entry) => entry.fieldKey),
      ["phone", "father_name"],
    );
  });

  it("ignores a field she blanked, because blank means no change", () => {
    // lib/fields.ts treats blank as "no answer", never as "erase this". The
    // summary has to agree or it would promise the office a deletion that the
    // server will not perform.
    const roster = [student("s1", "Ravi", { phone: "9876543210" })];
    const result = summarise(roster, [PHONE], {
      s1: row("edited", { phone: "" }),
    });

    assert.equal(result.changed.length, 0);
    assert.equal(result.confirmed.length, 1);
  });

  it("is empty when nothing has been answered at all", () => {
    const roster = [student("s1", "Ravi"), student("s2", "Sita")];
    const result = summarise(roster, [PHONE], {});

    assert.equal(result.empty, true);
    assert.equal(result.untouched.length, 2);
  });

  it("adds up to the whole roster, once each", () => {
    const roster = [
      student("s1", "Ravi", { phone: "9876543210" }),
      student("s2", "Sita", { phone: "9876543211" }),
      student("s3", "Amit"),
      student("s4", "Nita"),
    ];
    const result = summarise(roster, [PHONE], {
      s1: row("edited", { phone: "9000000001" }),
      s2: row("confirmed"),
      s3: row("absent"),
      s4: row("todo"),
    });

    const students = new Set([
      ...result.changed.map((entry) => entry.studentId),
      ...result.confirmed.map((entry) => entry.studentId),
      ...result.notPresent.map((entry) => entry.studentId),
      ...result.partial.map((entry) => entry.studentId),
      ...result.untouched.map((entry) => entry.studentId),
    ]);
    assert.equal(students.size, roster.length);
  });

  it("lists a half-filled card as partial, not as unanswered", () => {
    // Saying "जवाब बाकी है" about a child whose number the office already has
    // is the same lie in the other direction — she would go looking for a value
    // she has already given.
    const roster = [student("s1", "Ravi")];
    const result = summarise(roster, [PHONE, FATHER], {
      s1: row("partial", { phone: "9000000001" }),
    });

    assert.equal(result.untouched.length, 0);
    assert.equal(result.confirmed.length, 0);
    assert.equal(result.partial.length, 1);
    assert.equal(result.partial[0]!.studentId, "s1");
  });

  it("names the field a partial card is still waiting on, in Hindi", () => {
    const roster = [student("s1", "Ravi")];
    const result = summarise(roster, [PHONE, FATHER], {
      s1: row("partial", { phone: "9000000001" }),
    });

    assert.deepEqual(result.partial[0]!.missing, [
      { en: "Father", hi: "पिता का नाम" },
    ]);
  });

  it("still shows what she DID type on a partial card", () => {
    // It has gone to the office, so it belongs on the receipt like any other
    // change — and she has to be able to tap it if the digit was wrong.
    const roster = [student("s1", "Ravi")];
    const result = summarise(roster, [PHONE, FATHER], {
      s1: row("partial", { phone: "9000000001" }),
    });

    assert.equal(result.changed.length, 1);
    assert.equal(result.changed[0]!.to, "9000000001");
    assert.equal(result.empty, false);
  });

  it("never calls a partial card confirmed, even with nothing to diff", () => {
    // She retyped the number we already held while the other box stayed empty:
    // one entered field, no change. That is not "आपने सही बताई".
    const roster = [student("s1", "Ravi", { phone: "9876543210" })];
    const result = summarise(roster, [PHONE, FATHER], {
      s1: row("partial", { phone: "9876543210" }),
    });

    assert.equal(result.changed.length, 0);
    assert.equal(result.confirmed.length, 0);
    assert.equal(result.partial.length, 1);
  });
});
