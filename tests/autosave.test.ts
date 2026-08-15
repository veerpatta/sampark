import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  judgeRow,
  missingRequired,
  pickBatch,
  rowPartial,
  rowReady,
  rowTouched,
  shouldFlush,
  soleMatch,
  terminal,
  FLUSH_AT_ROWS,
  MIN_FLUSH_INTERVAL_MS,
} from "../src/components/teacher/autosave";
import type { RowState, TeacherField } from "../src/components/teacher/types";

/**
 * The rules behind saving as she types.
 *
 * Two rules matter above the rest.
 *
 * An UNFINISHED row does not commit. A half-typed phone number is not an
 * answer, and with no button to press a timer is the only thing that could
 * decide otherwise.
 *
 * A row missing something the school asked for is PARTIAL, not done. It used to
 * commit as finished the moment the first box was valid, which closed the card
 * over an empty box nobody would ever see again.
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

const photo: TeacherField = {
  key: "photo",
  labelEn: "Student photo",
  labelHi: "फ़ोटो",
  mode: "verify",
  inputType: "photo",
  exactLen: null,
  pattern: null,
  maxValue: null,
  options: null,
  targetColumn: "photo_path",
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

/**
 * The three-way verdict, and the bug it exists for.
 *
 * `village` is collect-mode: the school holds nothing for it anywhere, so it is
 * always a genuine hole and always shows up in `required`.
 */
const village: TeacherField = {
  key: "village",
  labelEn: "Village",
  labelHi: "गाँव",
  mode: "collect",
  inputType: "text",
  exactLen: null,
  pattern: null,
  maxValue: null,
  options: null,
  targetColumn: "village",
};

describe("judgeRow", () => {
  it("is unfinished for an untouched row, never partial", () => {
    // The whole reason a timer is allowed to commit anything: a card she opened
    // and walked away from must not upload itself as a half-answer.
    assert.equal(judgeRow([phone], row({}), ["phone"]), "unfinished");
    assert.equal(judgeRow([phone], row({ phone: "" }), ["phone"]), "unfinished");
  });

  it("is unfinished while anything entered is half-typed, whatever else is done", () => {
    assert.equal(
      judgeRow([phone, village], row({ village: "Amet", phone: "98" }), [
        "phone",
        "village",
      ]),
      "unfinished",
    );
  });

  it("is PARTIAL when what she typed is settled and a required field is empty", () => {
    // THE BUG. Two things asked for, one filled: the row used to call itself
    // finished a second later, close over the empty box, and count as done.
    assert.equal(
      judgeRow([phone, village], row({ village: "Amet" }), ["phone", "village"]),
      "partial",
    );
  });

  it("is PARTIAL while a photograph is still queued on the phone", () => {
    /*
     * The whole reason the photo queue writes nothing into the row until the
     * upload succeeds.
     *
     * A photo waiting for signal leaves its key unfilled, so this reads exactly
     * as it does for any other empty required box: the row stays open, stays in
     * the count, and is not `ready`. Nothing in autosave.ts knows a camera
     * exists — and it must stay that way, because the alternative is a sentinel
     * value that judgeRow would have to learn to disbelieve.
     */
    assert.equal(
      judgeRow([photo, village], row({ village: "Amet" }), ["photo", "village"]),
      "partial",
    );
    // And once the pathname lands, it is an ordinary finished row.
    assert.equal(
      judgeRow(
        [photo, village],
        row({ village: "Amet", photo: "students/S1/20260810-aabbccddeeff001122334455.jpg" }),
        ["photo", "village"],
      ),
      "ready",
    );
  });

  it("is partial when a required field was typed and then cleared", () => {
    assert.equal(
      judgeRow([phone, village], row({ village: "Amet", phone: "" }), [
        "phone",
        "village",
      ]),
      "partial",
    );
  });

  it("is ready once every required field carries a valid value", () => {
    assert.equal(
      judgeRow([phone, village], row({ village: "Amet", phone: "9876543210" }), [
        "phone",
        "village",
      ]),
      "ready",
    );
  });

  it("is ready when the only untouched fields are ones the school already holds", () => {
    // required is empty, which is the old rule and still the right one: leaving
    // a value we hold alone means "unchanged, still correct".
    assert.equal(judgeRow([phone, father], row({ father_name: "Ramesh" }), []), "ready");
  });

  it("defaults required to empty, which is exactly the old behaviour", () => {
    // Not laziness. Making the argument mandatory would turn every untouched
    // verify field into a hole, which is the opposite failure and a louder one.
    assert.equal(
      judgeRow([phone, father], row({ father_name: "Ramesh" })),
      judgeRow([phone, father], row({ father_name: "Ramesh" }), []),
    );
  });
});

describe("rowPartial", () => {
  it("is false for an untouched row and false for a finished one", () => {
    assert.equal(rowPartial([phone, village], row({}), ["phone", "village"]), false);
    assert.equal(
      rowPartial([phone, village], row({ phone: "9876543210", village: "Amet" }), [
        "phone",
        "village",
      ]),
      false,
    );
  });

  it("and rowReady are never both true", () => {
    const half = row({ village: "Amet" });
    const required = ["phone", "village"];
    assert.equal(rowPartial([phone, village], half, required), true);
    assert.equal(rowReady([phone, village], half, required), false);
  });
});

describe("missingRequired", () => {
  it("lists only the empty required keys, in the order they were asked", () => {
    assert.deepEqual(missingRequired(row({ village: "Amet" }), ["phone", "village"]), [
      "phone",
    ]);
  });

  it("counts a blank string as missing, not as an answer", () => {
    assert.deepEqual(missingRequired(row({ phone: "" }), ["phone"]), ["phone"]);
  });

  it("is empty when nothing is required, whatever the row holds", () => {
    assert.deepEqual(missingRequired(row({}), []), []);
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

  it("takes a PARTIAL row — what she typed has to reach the school", () => {
    // Partial is not done, but it is not nothing either. Holding a real phone
    // number on the phone until she fills a second box she may never come back
    // to loses it to a closed tab, and that is the worse of the two failures.
    const withPartial: Record<string, RowState> = {
      ...rows,
      s2: { status: "partial", values: { phone: "9876543210" } },
    };
    assert.deepEqual(pickBatch(order, withPartial, new Set(), new Set()), [
      "s1",
      "s2",
      "s3",
    ]);
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

/**
 * When the caret is allowed to leave a box on its own.
 *
 * The rule this replaces could only ask "has a fixed-length field reached its
 * length", which is a phone number and an Aadhaar number and nothing else. FA
 * marks have a maximum and no fixed length, so every one of them needed an
 * explicit Enter.
 */
describe("terminal", () => {
  const marks: TeacherField = {
    key: "fa1_hindi",
    labelEn: "FA1 Hindi",
    labelHi: "एफ़ए1 हिन्दी",
    mode: "collect",
    inputType: "number",
    exactLen: null,
    pattern: null,
    maxValue: "25",
    options: null,
    targetColumn: null,
  };

  it("is never terminal on an empty box", () => {
    assert.equal(terminal(phone, ""), false);
    assert.equal(terminal(marks, ""), false);
  });

  it("still ends a fixed-length field at its length", () => {
    assert.equal(terminal(phone, "9876543210"), true);
    // Nine of ten. Unfinished, not wrong, and the caret stays put.
    assert.equal(terminal(phone, "987654321"), false);
  });

  it("ends a bounded number once no further digit could be legal", () => {
    // Out of 25: a leading 3 can only become 30 or more.
    assert.equal(terminal(marks, "3"), true);
    assert.equal(terminal(marks, "9"), true);
  });

  it("waits where a second digit is still live", () => {
    // 1 could be 1, or 10 through 19. 2 could be 2, or 20 through 25.
    assert.equal(terminal(marks, "1"), false);
    assert.equal(terminal(marks, "2"), false);
    assert.equal(terminal(marks, "0"), false);
  });

  it("ends a two-digit mark, which is most of them", () => {
    assert.equal(terminal(marks, "18"), true);
    assert.equal(terminal(marks, "25"), true);
  });

  it("never moves her on from a value that does not validate", () => {
    // 26 is over the maximum. Advancing would scroll the error off her screen.
    assert.equal(terminal(marks, "26"), false);
  });

  it("leaves an unbounded field alone", () => {
    assert.equal(terminal(father, "Rana"), false);
  });
});

/**
 * The type-to-filter box that stands in for a select above a dozen options.
 *
 * Moving her on the moment the text matches an option is wrong whenever one
 * option is a prefix of another: she would be carried off "Amet" while still
 * four keystrokes from "Amet Road".
 */
describe("soleMatch", () => {
  const routes = ["Amet", "Amet Road", "Kelwa", "Kunthwa"];

  it("is false for anything that is not on the list", () => {
    assert.equal(soleMatch(routes, "Ame"), false);
    assert.equal(soleMatch(routes, "Delhi"), false);
    assert.equal(soleMatch(routes, ""), false);
  });

  it("holds while a longer option is still reachable", () => {
    assert.equal(soleMatch(routes, "Amet"), false);
  });

  it("commits once nothing on the list can extend it", () => {
    assert.equal(soleMatch(routes, "Amet Road"), true);
    assert.equal(soleMatch(routes, "Kelwa"), true);
  });

  it("does not treat a shared prefix between two OTHER options as ambiguity", () => {
    // Kelwa and Kunthwa share "K" and neither extends the other.
    assert.equal(soleMatch(routes, "Kunthwa"), true);
  });
});
