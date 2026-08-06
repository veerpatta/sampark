import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canCarryDown, suggestForRow } from "../src/components/teacher/suggest";
import type {
  RowState,
  TeacherField,
  TeacherRosterRow,
} from "../src/components/teacher/types";

/**
 * Carrying a value down from the row above.
 *
 * The rule that earns this its place is the one about phone numbers: it must
 * never offer one. Two unrelated children sharing a number is the error nobody
 * can spot afterwards, because in a spreadsheet every number looks equally
 * plausible.
 */

const field = (over: Partial<TeacherField>): TeacherField => ({
  key: "bus_route",
  labelEn: "Bus route",
  labelHi: "बस रूट",
  mode: "verify",
  inputType: "select",
  exactLen: null,
  pattern: null,
  maxValue: null,
  options: ["Amet City", "Agariya"],
  targetColumn: "bus_route",
  ...over,
});

const route = field({});
const phone = field({
  key: "phone",
  inputType: "tel",
  exactLen: 10,
  options: null,
});
const village = field({ key: "village", inputType: "text", options: null });

const student = (
  id: string,
  values: Record<string, string | null> = {},
): TeacherRosterRow => ({
  studentId: id,
  srNo: null,
  name: id,
  route: null,
  house: null,
  classLabel: null,
  fatherName: null,
  siblingPhone: null,
  values,
});

const answered = (values: Record<string, string>): RowState => ({
  status: "edited",
  values,
});

describe("canCarryDown", () => {
  it("offers a select — a 29-option wheel is the thing worth skipping", () => {
    assert.equal(canCarryDown(route), true);
  });

  it("NEVER offers a phone number", () => {
    assert.equal(canCarryDown(phone), false);
  });

  it("never offers any fixed-length field", () => {
    // Aadhaar, Jan Aadhaar — identifiers are never shared between children.
    assert.equal(canCarryDown(field({ key: "aadhaar", exactLen: 12 })), false);
  });

  it("offers village, and not free text in general", () => {
    assert.equal(canCarryDown(village), true);
    assert.equal(
      canCarryDown(field({ key: "father_name", inputType: "text", options: null })),
      false,
    );
  });
});

describe("suggestForRow", () => {
  const order = [
    student("s1", { bus_route: "Amet City" }),
    student("s2"),
    student("s3"),
  ];

  it("offers what the row above already holds", () => {
    assert.equal(suggestForRow(route, order, 1, {}), "Amet City");
  });

  it("prefers what she just typed over what was on record", () => {
    // She has moved three children onto a new route; that is the live answer.
    const rows = { s1: answered({ bus_route: "Agariya" }) };
    assert.equal(suggestForRow(route, order, 1, rows), "Agariya");
  });

  it("walks further up when the row directly above is blank", () => {
    assert.equal(suggestForRow(route, order, 2, {}), "Amet City");
  });

  it("offers nothing for the first row", () => {
    assert.equal(suggestForRow(route, order, 0, {}), null);
  });

  it("offers nothing when no row above has an answer", () => {
    const blank = [student("a"), student("b")];
    assert.equal(suggestForRow(route, blank, 1, {}), null);
  });

  it("offers nothing for a phone, however many rows above have one", () => {
    const withPhones = [
      student("s1", { phone: "9111111111" }),
      student("s2"),
    ];
    assert.equal(suggestForRow(phone, withPhones, 1, {}), null);
  });
});
