import "../drizzle/env";
import assert from "node:assert/strict";
import { describe, test, after } from "node:test";
import { eq, getTableColumns } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import {
  applyEdits,
  EDITABLE_COLUMNS,
  editFields,
  logKeyFor,
  writeOfficeEdit,
} from "../src/lib/student-edit";
import { mayWrite, type Precedence } from "../src/lib/precedence";
import { IMPORT_COLUMNS } from "../src/lib/students-import";
import { createScenario, cleanup, studentById, changeLogForStudent } from "./fixtures";
import type { Student } from "../drizzle/schema";

/**
 * The office correcting a record by hand.
 *
 * The file is named office-edit rather than student-edit on purpose: fixtures.ts
 * derives its teardown prefix from the filename, and `student-edit` truncated
 * to the same eight characters as `student-export`. The tag has been widened to
 * ten, which fixes it — but two files whose names differ only past character
 * eight is a trap worth simply not laying.
 *
 * What is actually at stake here is the promise on the student page: that an
 * edit is recorded, and that no later import can undo it. Both are asserted
 * against the real database, because both are properties of rows.
 */

/* ================================ the rules ================================ */

const OPTIONS = new Map<string, string[]>([
  ["gender", ["Male", "Female"]],
  ["category", ["GENERAL", "OBC", "SC", "SBC", "ST"]],
]);

function fakeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "S1",
    srNo: "42",
    admissionNo: null,
    classLabel: "Class 6",
    section: null,
    rollNo: 7,
    name: "AARTI KUMARI",
    fatherName: "RAMESH LAL",
    motherName: null,
    phone: "9414000000",
    altPhone: null,
    dob: null,
    gender: "Female",
    category: "GENERAL",
    aadhaar: null,
    janAadhaar: null,
    village: "AMET",
    address: null,
    busRoute: null,
    house: null,
    aadhaarLast4: null,
    photoPath: null,
    status: "active",
    source: "psp",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Student;
}

/** Read from a plain object, the way the action reads from FormData. */
const from = (values: Record<string, string>) => (column: string) =>
  Object.prototype.hasOwnProperty.call(values, column) ? values[column]! : null;

describe("what counts as a change", () => {
  const student = fakeStudent();
  const fields = editFields(student, OPTIONS);

  test("an untouched field is not a change", () => {
    const { changes, errors } = applyEdits(student, fields, from({ village: "AMET" }));
    assert.deepEqual(errors, {});
    assert.equal(changes.length, 0);
  });

  test("a field absent from the form is left alone", () => {
    // Absent is not the same as cleared. Only a box that was rendered can have
    // been emptied on purpose — otherwise a partial form erases everything it
    // did not happen to include.
    const { changes } = applyEdits(student, fields, from({}));
    assert.equal(changes.length, 0);
  });

  test("normalising back onto the stored value is not a change", () => {
    // She retyped the same number with a space in it. Nothing moved, so nothing
    // should reach the change log.
    const { changes } = applyEdits(student, fields, from({ phone: "94140 00000" }));
    assert.equal(changes.length, 0);
  });

  test("a cleared box erases, unlike a blank cell in an import", () => {
    /*
     * THIS IS THE ONE THAT LOOKS LIKE A CONTRADICTION AND IS NOT.
     * students-import.ts treats a blank as "no change" because an empty column
     * in a spreadsheet is a column the file does not carry. A box that was
     * showing AMET and is now empty was emptied by a person.
     */
    const { changes, errors } = applyEdits(student, fields, from({ village: "" }));
    assert.deepEqual(errors, {});
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.from, "AMET");
    assert.equal(changes[0]!.to, null);
    assert.equal(changes[0]!.toValue, null);
  });
});

describe("what the form refuses", () => {
  const student = fakeStudent();
  const fields = editFields(student, OPTIONS);

  test("a NOT NULL column cannot be cleared", () => {
    // Without this the null reaches Postgres and comes back as a constraint
    // violation, which the office sees as a crashed page.
    const { changes, errors } = applyEdits(student, fields, from({ name: "  " }));
    assert.equal(changes.length, 0);
    assert.match(errors.name!, /cannot be empty/i);
  });

  test("a bad phone number is refused, not silently discarded", () => {
    // The importer answers this with { value: null, warning } and moves on. On
    // a form that means she types a correction, is told it saved, and the old
    // number is still there.
    const { changes, errors } = applyEdits(student, fields, from({ phone: "12345" }));
    assert.equal(changes.length, 0);
    assert.ok(errors.phone);
  });

  test("the refusal does not repeat the importer's 'left unchanged'", () => {
    // True of an import preview, false here: the whole save is being rejected
    // and what she typed is still in the box.
    const { errors } = applyEdits(student, fields, from({ phone: "12345" }));
    assert.doesNotMatch(errors.phone!, /left unchanged/i);
  });

  test("one bad field refuses the whole save", () => {
    // Not "apply the good ones and warn about the bad". A partial write is the
    // outcome nobody can reconstruct afterwards.
    const { changes, errors } = applyEdits(
      student,
      fields,
      from({ fatherName: "SURESH LAL", phone: "12345" }),
    );
    assert.equal(Object.keys(errors).length, 1);
    assert.equal(changes.length, 0, "nothing is planned while anything is invalid");
  });

  test("a class off the canonical list is refused", () => {
    // "12 Science" would have been a bad example — it is one of the nineteen.
    const { errors } = applyEdits(student, fields, from({ classLabel: "Class 13" }));
    assert.ok(errors.classLabel);
  });
});

describe("the category trap", () => {
  /*
   * IMPORT_COLUMNS normalises category against GEN/OBC/SC/ST/EWS. This school
   * holds GENERAL and SBC — 45 children are SBC and nobody is EWS — which is
   * what the field registry says and what lib/students.ts calls the truth.
   *
   * Validating with the importer's list would have made the form offer GENERAL
   * in a dropdown and then reject it on the way back, which is the most
   * baffling failure a form can produce. So a select is validated against the
   * options it rendered.
   */
  const student = fakeStudent({ category: "OBC" });
  const fields = editFields(student, OPTIONS);

  test("the dropdown offers what the school actually holds", () => {
    const category = fields.find((f) => f.column === "category")!;
    assert.deepEqual(category.options, ["GENERAL", "OBC", "SC", "SBC", "ST"]);
  });

  test("SBC is accepted, though the importer would reject it", () => {
    const importer = IMPORT_COLUMNS.find((c) => c.column === "category")!;
    assert.ok(importer.normalise("SBC").warning, "precondition: the importer refuses SBC");

    const { changes, errors } = applyEdits(student, fields, from({ category: "SBC" }));
    assert.deepEqual(errors, {});
    assert.equal(changes[0]?.to, "SBC");
  });

  test("a value outside the offered options is refused", () => {
    const { errors } = applyEdits(student, fields, from({ category: "EWS" }));
    assert.ok(errors.category);
  });
});

describe("a stored value the canonical list does not contain", () => {
  /*
   * FOUND BY OPENING THE PAGE, NOT BY READING THE CODE.
   *
   * The registry says gender is Male/Female and category is GENERAL/OBC/...;
   * the database holds "M", "F" and "General". A <select> whose defaultValue
   * matches no <option> silently renders as the first one — the blank — so the
   * field READ as unset, and saving the untouched form would have posted "",
   * which applyEdits would have read as a deliberate clear and erased.
   *
   * One visit to a student page, one press of Save, and gender and category are
   * null for that child. This is the test that says it cannot happen again.
   */
  const student = fakeStudent({ gender: "M", category: "General" });
  const fields = editFields(student, OPTIONS);

  test("is offered, so the control shows what the child actually is", () => {
    const gender = fields.find((f) => f.column === "gender")!;
    assert.ok(gender.options!.includes("M"), "the stored value must be selectable");
    // The canonical choices still lead; the odd one out goes last.
    assert.deepEqual(gender.options, ["Male", "Female", "M"]);
    assert.equal(gender.value, "M");
  });

  test("saving an untouched form does not erase it", () => {
    const { changes, errors } = applyEdits(
      student,
      fields,
      from({ gender: "M", category: "General" }),
    );
    assert.deepEqual(errors, {});
    assert.equal(changes.length, 0, "nothing was touched, so nothing may change");
  });

  test("the canonical spelling is still what she can move it to", () => {
    const { changes, errors } = applyEdits(student, fields, from({ gender: "Female" }));
    assert.deepEqual(errors, {});
    assert.equal(changes[0]!.from, "M");
    assert.equal(changes[0]!.to, "Female");
  });
});

describe("column types and names", () => {
  test("roll number reaches the integer column as a number", () => {
    // Every normalise() returns a string; roll_no is integer(). Handing
    // Postgres "7" through a cast is how a text value lands in an int column.
    const student = fakeStudent({ rollNo: 7 });
    const fields = editFields(student, OPTIONS);
    const { changes } = applyEdits(student, fields, from({ rollNo: "11" }));

    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.to, 11);
    assert.equal(typeof changes[0]!.to, "number");
    // change_log.to_value is text, whatever the column is.
    assert.equal(changes[0]!.toValue, "11");
  });

  test("value_sources gets the database name, change_log the registry key", () => {
    // The asymmetry is real and load-bearing: the audit screens join field_defs
    // on change_log.field_key to find a label, and the photo is the one field
    // whose two names differ.
    assert.equal(logKeyFor("photo_path"), "photo");
    assert.equal(logKeyFor("father_name"), "father_name");
  });

  test("the student id is not editable", () => {
    // Four tables carry a foreign key to it and every photo pathname embeds it.
    assert.equal(EDITABLE_COLUMNS.some((spec) => spec.column === "id"), false);
  });

  test("every importable column except the id is editable", () => {
    // Derived, not listed — the house field went missing from three surfaces
    // once already because a hand-maintained list drifted.
    assert.equal(EDITABLE_COLUMNS.length, IMPORT_COLUMNS.length - 1);
  });

  test("no editable column is one student-columns.ts protects", () => {
    // id, created_at, updated_at and source must never be a write target.
    const protectedNames = new Set(["id", "createdAt", "updatedAt", "source"]);
    for (const spec of EDITABLE_COLUMNS) {
      assert.equal(protectedNames.has(spec.column), false, spec.column);
    }
  });

  test("a NOT NULL column is discovered from the schema, not assumed", () => {
    // If this ever fails, a column gained or lost NOT NULL and the form's
    // "cannot be empty" rule silently moved with it.
    const columns = getTableColumns(schema.students);
    const required = Object.entries(columns)
      .filter(([, column]) => column.notNull)
      .map(([property]) => property)
      .filter((property) => EDITABLE_COLUMNS.some((spec) => spec.column === property));
    assert.deepEqual(required.sort(), ["classLabel", "name", "status"]);
  });
});

/* ============================== the real write ============================= */

describe("writing an edit", () => {
  after(cleanup);

  test("lands in master, in the log, and in value_sources", async () => {
    const scenario = await createScenario();
    const studentId = scenario.studentIds[0]!;
    const before = await studentById(studentId);

    const fields = editFields(before!, OPTIONS);
    const { changes, errors } = applyEdits(
      before!,
      fields,
      from({ fatherName: "SURESH LAL", village: "KELWA" }),
    );
    assert.deepEqual(errors, {});
    assert.equal(changes.length, 2);

    await writeOfficeEdit({ studentId, changes, decidedBy: scenario.userId });

    const after_ = await studentById(studentId);
    assert.equal(after_!.fatherName, "SURESH LAL");
    assert.equal(after_!.village, "KELWA");

    const log = await changeLogForStudent(studentId);
    assert.equal(log.length, 2);
    for (const row of log) {
      // The two facts that say "an admin typed this" must never disagree.
      assert.equal(row.submissionId, null);
      assert.equal(row.decision, "edited");
      assert.equal(row.decidedBy, scenario.userId);
    }
    assert.equal(
      log.find((row) => row.fieldKey === "father_name")!.toValue,
      "SURESH LAL",
    );

    const sources = await db
      .select()
      .from(schema.valueSources)
      .where(eq(schema.valueSources.studentId, studentId));

    const father = sources.find((row) => row.fieldKey === "father_name");
    assert.equal(father?.sourceKey, "office");
  });

  test("an office edit is what stops the next import undoing it", async () => {
    /*
     * The whole point of the stamp. `office` sits in HUMAN_SOURCES, so mayWrite
     * refuses every import against it — which is why the office can correct a
     * number in September and still have it in March.
     */
    const precedence: Precedence = {
      owners: new Map([["phone", "psp"]]),
      ranks: new Map([
        ["psp", 30],
        ["office", 90],
      ]),
    };

    const verdict = mayWrite(
      "phone",
      "psp",
      { sourceKey: "office", sourceUpdatedAt: new Date() },
      precedence,
    );

    assert.equal(verdict.write, false);
    assert.match(
      "reason" in verdict ? verdict.reason : "",
      /the office set this by hand/,
    );
  });

  test("an empty change set writes nothing at all", async () => {
    const scenario = await createScenario();
    const studentId = scenario.studentIds[0]!;

    await writeOfficeEdit({ studentId, changes: [], decidedBy: scenario.userId });

    const log = await changeLogForStudent(studentId);
    assert.equal(log.length, 0, "a save that changed nothing leaves no trail");
  });
});
