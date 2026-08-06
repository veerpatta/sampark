import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickBatch,
  rowReady,
  rowTouched,
  shouldFlush,
  FLUSH_AT_ROWS,
  MIN_FLUSH_INTERVAL_MS,
} from "../src/components/teacher/autosave";
import type { RowState, TeacherField } from "../src/components/teacher/types";

/**
 * The rules behind saving as she types.
 *
 * The one that matters most is that an UNFINISHED row does not commit. A
 * half-typed phone number is not an answer, and with no button to press a timer
 * is the only thing that could decide otherwise.
 */

const phone: TeacherField = {
  key: "phone",
  labelEn: "Phone",
  labelHi: "फ़ोन",
  mode: "verify",
  inputType: "tel",
  exactLen: 10,
  pattern: null,
  maxValue: null,
  options: null,
  targetColumn: "phone",
};

const father: TeacherField = {
  key: "father_name",
  labelEn: "Father",
  labelHi: "पिता",
  mode: "verify",
  inputType: "text",
  exactLen: null,
  pattern: null,
  maxValue: null,
  options: null,
  targetColumn: "father_name",
};

const row = (values: Record<string, string>): RowState => ({
  status: "editing",
  values,
});

describe("rowReady", () => {
  it("commits a complete valid value", () => {
    assert.equal(rowReady([phone], row({ phone: "9876543210" })), true);
  });

  it("REFUSES a half-typed fixed-length field", () => {
    // Four of ten digits is not invalid, it is unfinished. The distinction is
    // the whole reason a timer is allowed to commit anything at all.
    assert.equal(rowReady([phone], row({ phone: "9876" })), false);
  });

  it("refuses a row where nothing has been entered", () => {
    // She opened it and moved on. Committing would tell the office it had been
    // checked when nobody looked at it.
    assert.equal(rowReady([phone], row({})), false);
    assert.equal(rowReady([phone], row({ phone: "" })), false);
  });

  it("refuses a value that is complete but not valid", () => {
    const house: TeacherField = {
      key: "house",
      labelEn: "House",
      labelHi: "सदन",
      mode: "verify",
      inputType: "select",
      exactLen: null,
      pattern: null,
      maxValue: null,
      options: ["Rana Pratap", "Rana Sanga"],
      targetColumn: "house",
    };

    assert.equal(rowReady([house], row({ house: "Rana Pratap" })), true);
    assert.equal(rowReady([house], row({ house: "Nonesuch" })), false);
  });

  it("refuses a number over its maximum", () => {
    const marks: TeacherField = {
      key: "fa_maths",
      labelEn: "Maths",
      labelHi: "गणित",
      mode: "collect",
      inputType: "number",
      exactLen: null,
      pattern: null,
      maxValue: "25",
      options: null,
      targetColumn: null,
    };

    assert.equal(rowReady([marks], row({ fa_maths: "18" })), true);
    assert.equal(rowReady([marks], row({ fa_maths: "30" })), false);
  });

  it("ignores fields she left alone and judges only what she typed", () => {
    // She corrected the father's name; the phone was already right and she
    // never touched it. The row is finished.
    assert.equal(
      rowReady([phone, father], row({ father_name: "Ramesh" })),
      true,
    );
  });

  it("holds the whole row back while any entered field is unfinished", () => {
    assert.equal(
      rowReady([phone, father], row({ father_name: "Ramesh", phone: "98" })),
      false,
    );
  });

  it("accepts a free-text field of any length", () => {
    assert.equal(rowReady([father], row({ father_name: "R" })), true);
  });
});

describe("rowTouched", () => {
  it("is false for an untouched row and true once anything is typed", () => {
    assert.equal(rowTouched(row({})), false);
    assert.equal(rowTouched(row({ phone: "" })), false);
    assert.equal(rowTouched(row({ phone: "9" })), true);
  });
});

describe("pickBatch", () => {
  const order = [
    { studentId: "s1" },
    { studentId: "s2" },
    { studentId: "s3" },
  ];

  const rows: Record<string, RowState> = {
    s1: { status: "confirmed", values: {} },
    s2: { status: "editing", values: { phone: "98" } },
    s3: { status: "absent", values: {} },
  };

  it("takes answered rows and leaves the ones still being typed", () => {
    assert.deepEqual(pickBatch(order, rows, new Set(), new Set()), ["s1", "s3"]);
  });

  it("leaves out anything the server has already acknowledged", () => {
    assert.deepEqual(pickBatch(order, rows, new Set(["s1"]), new Set()), ["s3"]);
  });

  it("leaves out anything already in the air", () => {
    // Otherwise a row she corrects mid-upload goes twice under two keys, and
    // the second write is the one that loses.
    assert.deepEqual(pickBatch(order, rows, new Set(), new Set(["s1"])), ["s3"]);
  });

  it("keeps the roster's order, so a batch reads the way the screen does", () => {
    const all: Record<string, RowState> = {
      s1: { status: "confirmed", values: {} },
      s2: { status: "confirmed", values: {} },
      s3: { status: "confirmed", values: {} },
    };
    assert.deepEqual(pickBatch(order, all, new Set(), new Set()), [
      "s1",
      "s2",
      "s3",
    ]);
  });
});

describe("shouldFlush", () => {
  const past = MIN_FLUSH_INTERVAL_MS + 1;

  it("never uploads an empty batch", () => {
    assert.equal(shouldFlush(0, 99_999, past), false);
  });

  it("uploads once enough rows have piled up", () => {
    assert.equal(shouldFlush(FLUSH_AT_ROWS, 0, past), true);
  });

  it("uploads a single row once she has stopped for a moment", () => {
    assert.equal(shouldFlush(1, 5000, past), true);
  });

  it("waits while she is still typing and only one row is waiting", () => {
    assert.equal(shouldFlush(1, 500, past), false);
  });

  it("respects the floor between uploads, whatever else is true", () => {
    // The rate limit is 30 a minute per token and a retry needs room inside it.
    assert.equal(shouldFlush(FLUSH_AT_ROWS, 99_999, 100), false);
  });
});
