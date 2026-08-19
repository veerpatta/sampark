import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isBlankRow,
  requiredKeys,
  type TeacherField,
  type TeacherRosterRow,
} from "../src/components/teacher/types";

/**
 * The split that the teacher screen is built on.
 *
 * A Class 8 phone request covers 46 students, of whom 40 already have a correct
 * number and 6 have nothing. The 6 are the entire reason the request was sent.
 * If this predicate is wrong, either she hunts for them among 46 identical
 * cards again, or — worse — a blank ends up in the group that one button
 * confirms, and the office is told an empty field was checked.
 *
 * Every value here is invented. Rule 12.
 */

const phone: TeacherField = {
  key: "phone",
  labelEn: "Mobile number",
  labelHi: "मोबाइल नंबर",
  mode: "verify",
  inputType: "tel",
  exactLen: 10,
  pattern: null,
  maxValue: null,
  options: null,
  targetColumn: "phone",
};

const altPhone: TeacherField = { ...phone, key: "alt_phone", targetColumn: "alt_phone" };

const village: TeacherField = {
  ...phone,
  key: "village",
  labelEn: "Village",
  labelHi: "गाँव",
  mode: "collect",
  inputType: "text",
  exactLen: null,
  targetColumn: "village",
};

const row = (values: Record<string, string | null>): TeacherRosterRow => ({
  studentId: "ZZTEST1",
  srNo: "ZZ-1",
  name: "TEST CHILD",
  route: null,
  house: null,
  classLabel: null,
  fatherName: null,
  siblingPhone: null,
  answered: {},
  notPresent: false,
  values,
});

describe("isBlankRow", () => {
  test("a stored value means the row can be confirmed in bulk", () => {
    assert.equal(isBlankRow(row({ phone: "9000000000" }), [phone]), false);
  });

  test("null and empty string are both blank", () => {
    assert.equal(isBlankRow(row({ phone: null }), [phone]), true);
    assert.equal(isBlankRow(row({ phone: "" }), [phone]), true);
  });

  test("a missing key is blank — the snapshot simply held nothing", () => {
    assert.equal(isBlankRow(row({}), [phone]), true);
  });

  test("ANY missing field makes the row blank, not all of them", () => {
    // Otherwise a student with a father's number but no mother's would sit in
    // the group that one tap confirms, and the empty field would be reported
    // to the office as checked.
    assert.equal(
      isBlankRow(row({ phone: "9000000000", alt_phone: null }), [phone, altPhone]),
      true,
    );
  });

  test("a collect-mode field is always blank — we hold nothing anywhere", () => {
    assert.equal(isBlankRow(row({ village: "Somewhere" }), [village]), true);
  });
});

/**
 * The same predicate, asked the other question.
 *
 * The screen splits on "are there any holes"; the commit gate needs "which
 * ones", so that a card asking for two things and given one is not allowed to
 * call itself finished. If these two ever disagree about what a hole is, one of
 * the two lies — either she hunts for blanks among 46 identical cards, or a
 * half-filled card counts as done again.
 */
describe("requiredKeys", () => {
  test("skips a field the school already holds, keeps every collect-mode one", () => {
    assert.deepEqual(
      requiredKeys(row({ phone: "9000000000", village: "Somewhere" }), [
        phone,
        village,
      ]),
      ["village"],
    );
  });

  test("null, empty string and a missing key are all holes", () => {
    assert.deepEqual(requiredKeys(row({ phone: null }), [phone]), ["phone"]);
    assert.deepEqual(requiredKeys(row({ phone: "" }), [phone]), ["phone"]);
    assert.deepEqual(requiredKeys(row({}), [phone]), ["phone"]);
  });

  test("keeps the order the request asked in", () => {
    assert.deepEqual(requiredKeys(row({}), [phone, altPhone, village]), [
      "phone",
      "alt_phone",
      "village",
    ]);
  });

  test("isBlankRow is exactly 'are there any', and cannot drift from it", () => {
    const cases: Record<string, string | null>[] = [
      {},
      { phone: "9000000000" },
      { phone: null },
      { phone: "9000000000", alt_phone: "9000000001" },
      { phone: "", alt_phone: "9000000001" },
    ];
    for (const values of cases) {
      assert.equal(
        isBlankRow(row(values), [phone, altPhone]),
        requiredKeys(row(values), [phone, altPhone]).length > 0,
        `disagreed on ${JSON.stringify(values)}`,
      );
    }
  });
});
