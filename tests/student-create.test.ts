import "../drizzle/env";
import assert from "node:assert/strict";
import { describe, test, after } from "node:test";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { createStudent, newStudentFields, planNewStudent } from "../src/lib/student-edit";
import { loadOrigins, loadPrecedence, mayWrite, originOf } from "../src/lib/precedence";
import { temporaryStudentId } from "../src/lib/students-import";
import { createScenario, cleanup, studentById, changeLogForStudent } from "./fixtures";

/**
 * The office adding a child by hand.
 *
 * What is at stake is the same promise the edit form makes: every field is
 * recorded with a name, and no later import can undo it. Both are properties
 * of rows, so both are asserted against the real database.
 */
const OPTIONS = new Map<string, string[]>([
  ["gender", ["Male", "Female"]],
  ["category", ["GENERAL", "OBC", "SC", "SBC", "ST"]],
]);

const from = (values: Record<string, string>) => (column: string) =>
  Object.prototype.hasOwnProperty.call(values, column) ? values[column]! : null;

describe("createStudent", () => {
  after(cleanup);

  test("writes the row, one change_log row per field, and an office stamp on each", async () => {
    const scenario = await createScenario();
    // The fixture prefix is the first sixteen characters of any fixture id; a
    // child created under it is torn down with the rest.
    const id = `${scenario.studentIds[0]!.slice(0, 16)}N${temporaryStudentId().slice(4)}`;

    const plan = planNewStudent(
      newStudentFields(OPTIONS),
      from({ name: "New Test Child", classLabel: "Class 6", phone: "9414 000 111", gender: "Female", village: "Amet" }),
    );
    assert.deepEqual(plan.errors, {});

    await createStudent({ id, changes: plan.changes, decidedBy: scenario.userId, note: "admitted today" });

    const student = await studentById(id);
    assert.ok(student, "the row exists");
    assert.equal(student!.name, "New Test Child");
    assert.equal(student!.classLabel, "Class 6");
    assert.equal(student!.phone, "9414000111", "normalised on the way in");
    assert.equal(student!.status, "active", "the column default carries an untouched status");
    assert.equal(student!.source, "office");

    const log = await changeLogForStudent(id);
    assert.equal(log.length, 5, "one row per field written");
    assert.ok(log.every((row) => row.decision === "created"));
    assert.ok(log.every((row) => row.submissionId === null));
    assert.ok(log.every((row) => row.fromValue === null));
    assert.ok(log.every((row) => row.note === "admitted today"));
    assert.equal(log.find((row) => row.fieldKey === "phone")!.toValue, "9414000111");

    // The stamp is what stops the next PSP file overwriting what she typed.
    const origins = await loadOrigins([id]);
    const precedence = await loadPrecedence();
    for (const column of ["name", "class_label", "phone", "gender", "village"]) {
      const stored = originOf(origins, id, column);
      assert.equal(stored?.sourceKey, "office", `${column} is stamped office`);
      const verdict = mayWrite(column, "psp", stored, precedence);
      assert.equal(verdict.write, false, `a PSP import may not overwrite ${column}`);
    }
  });

  test("a temporary id has the shape the board expects", () => {
    assert.match(temporaryStudentId(), /^TMP-[0-9A-F]{8}$/);
    assert.notEqual(temporaryStudentId(), temporaryStudentId());
  });

  test("the row's timestamps say now, not the blank record's epoch", async () => {
    const scenario = await createScenario();
    const id = `${scenario.studentIds[0]!.slice(0, 16)}N${temporaryStudentId().slice(4)}`;
    const plan = planNewStudent(newStudentFields(OPTIONS), from({ name: "Another", classLabel: "Class 7" }));
    await createStudent({ id, changes: plan.changes, decidedBy: scenario.userId });
    const [row] = await db.select().from(schema.students).where(eq(schema.students.id, id));
    assert.ok(row!.createdAt.getTime() > Date.now() - 60_000);
  });
});
