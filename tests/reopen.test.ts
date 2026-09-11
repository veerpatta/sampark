import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  knownValues,
  requiredKeys,
  seedRow,
  type TeacherField,
  type TeacherRosterRow,
} from "../src/components/teacher/types";

/**
 * Reopening a link she is half way through.
 *
 * THE BUG THESE EXIST FOR. A teacher photographs twelve of forty-six children,
 * closes the tab, and opens the link again. Every row used to come back `todo`
 * with nothing in it — the page only ever saw the frozen snapshot, which is by
 * definition what we held BEFORE she started — so the twelve she had done sat
 * at the top of the list with the camera open, indistinguishable from the
 * thirty-four she had not. Her work was in the submissions table the whole
 * time. Nothing asked for it.
 *
 * Pure, so these run without a database or a DOM. The read-back query that
 * fills `answered` is exercised against the real database in teacher-link.test.ts.
 */

const field = (over: Partial<TeacherField> = {}): TeacherField => ({
  key: "photo",
  labelEn: "Student photo",
  labelHi: "बच्चे की फ़ोटो",
  mode: "verify",
  inputType: "photo",
  exactLen: null,
  pattern: null,
  maxValue: null,
  options: null,
  targetColumn: "photo_path",
  ...over,
});

const phone = field({
  key: "phone",
  labelEn: "Mobile",
  labelHi: "मोबाइल",
  inputType: "tel",
  exactLen: 10,
  targetColumn: "phone",
});

const PHOTO = "students/ZZTEST1/20260819-0123456789abcdef01234567.jpg";

const student = (over: Partial<TeacherRosterRow> = {}): TeacherRosterRow => ({
  studentId: "ZZTEST1",
  srNo: null,
  name: "TEST CHILD",
  route: null,
  house: null,
  classLabel: null,
  fatherName: null,
  siblingPhone: null,
  values: {},
  answered: {},
  elsewhere: {},
  notPresent: false,
  askNote: null,
  ...over,
});

describe("seedRow", () => {
  test("a child she has not reached is untouched, and not sent", () => {
    const seed = seedRow(student(), [field()]);
    assert.deepEqual(seed.row, { status: "todo", values: {} });
    assert.equal(seed.sent, false);
  });

  test("a photographed child comes back done, with the photograph", () => {
    const seed = seedRow(student({ answered: { photo: PHOTO } }), [field()]);
    assert.equal(seed.row.status, "edited");
    assert.equal(seed.row.values.photo, PHOTO);
    // The half that stops it uploading a second time under a fresh key.
    assert.equal(seed.sent, true);
  });

  test("one of two answered is partial — sent, and not finished", () => {
    const seed = seedRow(
      student({ answered: { phone: "9876543210" } }),
      [phone, field()],
    );
    assert.equal(seed.row.status, "partial");
    assert.equal(seed.row.values.phone, "9876543210");
    assert.equal(seed.sent, true);
  });

  test("both answered is done", () => {
    const seed = seedRow(
      student({ answered: { phone: "9876543210", photo: PHOTO } }),
      [phone, field()],
    );
    assert.equal(seed.row.status, "edited");
    assert.equal(seed.sent, true);
  });

  test("not in her class stays not in her class", () => {
    const seed = seedRow(student({ notPresent: true }), [field()]);
    assert.deepEqual(seed.row, { status: "absent", values: {} });
    assert.equal(seed.sent, true);
  });

  test("a field the request no longer asks about does not seed a row", () => {
    // A submission for a key that has since left field_keys must not make a
    // child look answered for a question nobody is asking any more.
    const seed = seedRow(student({ answered: { village: "Amet" } }), [field()]);
    assert.deepEqual(seed.row, { status: "todo", values: {} });
    assert.equal(seed.sent, false);
  });

  test("a hole the office had already filled is not one she owes", () => {
    // verify mode, value in the snapshot: leaving it alone is a real answer,
    // so a photo answered on top of it still reads as finished.
    const seed = seedRow(
      student({ values: { phone: "9000000000" }, answered: { photo: PHOTO } }),
      [phone, field()],
    );
    assert.equal(seed.row.status, "edited");
  });
});

describe("knownValues", () => {
  test("what she sent wins over what we held", () => {
    const merged = knownValues(
      student({ values: { phone: "9000000000" }, answered: { phone: "9876543210" } }),
    );
    assert.equal(merged.phone, "9876543210");
  });

  test("a photographed child leaves the blanks group", () => {
    // The half she actually feels: without the merge this child is required
    // again on every reload and sits at the top with the camera open.
    const child = student({ answered: { photo: PHOTO } });
    assert.deepEqual(requiredKeys(child, [field()]), ["photo"]);
    assert.deepEqual(
      requiredKeys({ values: knownValues(child) }, [field()]),
      [],
    );
  });
});

/**
 * The other link in the round.
 *
 * A round has two ways to answer for a child now — her own link, and the
 * office's master link over every group. What these pin is the seam between
 * them: she must SEE what the office did, so nobody photographs a child twice,
 * and she must never SEND it, because she did not say it.
 */
describe("what another link in the round already holds", () => {
  test("a child the office finished is not one she still owes", () => {
    const child = student({ elsewhere: { photo: PHOTO } });
    // Before the merge this child is required, which is the bug: the camera
    // opens on a child the school already has a photograph of.
    assert.deepEqual(requiredKeys(child, [field()]), ["photo"]);
    assert.deepEqual(
      requiredKeys({ values: knownValues(child) }, [field()]),
      [],
    );
  });

  test("and her row is seeded as sent, so her phone never re-uploads it", () => {
    const seed = seedRow(student({ elsewhere: { photo: PHOTO } }), [field()]);
    assert.equal(
      seed.sent,
      true,
      "sent keeps pickBatch from submitting the office's work under her token",
    );
    assert.deepEqual(
      seed.row.values,
      {},
      "and her client holds no value of its own to send",
    );
  });

  test("a child nobody has done is still hers to do", () => {
    const seed = seedRow(student(), [field()]);
    assert.equal(seed.sent, false);
  });

  test("her own correction still beats what the office supplied", () => {
    const merged = knownValues(
      student({
        values: { phone: "9000000000" },
        elsewhere: { phone: "9111111111" },
        answered: { phone: "9222222222" },
      }),
    );
    assert.equal(merged.phone, "9222222222", "newest wins, and hers is newest");
  });

  test("the office's answer beats the snapshot it was collected after", () => {
    const merged = knownValues(
      student({
        values: { phone: "9000000000" },
        elsewhere: { phone: "9111111111" },
      }),
    );
    assert.equal(merged.phone, "9111111111");
  });
});
