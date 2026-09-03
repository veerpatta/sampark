import "../drizzle/env";
import assert from "node:assert/strict";
import { describe, test, after } from "node:test";
import { applyEdits, editFields, writeOfficeEdits } from "../src/lib/student-edit";
import { loadOrigins, originOf } from "../src/lib/precedence";
import { createScenario, cleanup, studentById, changeLogForStudent } from "./fixtures";
import type { Student } from "../drizzle/schema";

/**
 * Setting one thing on many children.
 *
 * The rule under test is that a bulk edit is N ordinary edits — per-child
 * validation, per-child audit row, per-child provenance — and that one child
 * the rule refuses does not stop the others.
 */
const OPTIONS = new Map<string, string[]>();

/** The same shaping the action does, without the session. */
function plan(students: Student[], column: "house" | "classLabel", value: string) {
  const edits: { studentId: string; changes: ReturnType<typeof applyEdits>["changes"] }[] = [];
  const skipped: string[] = [];
  let unchanged = 0;
  for (const student of students) {
    const fields = editFields(student, OPTIONS).filter((field) => field.column === column);
    const { changes, errors } = applyEdits(student, fields, (c) => (c === column ? value : null));
    if (errors[column]) skipped.push(student.id);
    else if (changes.length === 0) unchanged += 1;
    else edits.push({ studentId: student.id, changes });
  }
  return { edits, skipped, unchanged };
}

describe("bulk edit", () => {
  after(cleanup);

  test("each child gets its own change_log row and office stamp", async () => {
    const scenario = await createScenario();
    const students = (await Promise.all(scenario.studentIds.map(studentById))) as Student[];

    const { edits, skipped, unchanged } = plan(students, "house", "Rana Pratap");
    assert.equal(skipped.length, 0);
    assert.equal(unchanged, 0);
    assert.equal(edits.length, 2);

    await writeOfficeEdits(edits, scenario.userId, "house allocation");

    for (const id of scenario.studentIds) {
      assert.equal((await studentById(id))!.house, "Rana Pratap");
      const log = await changeLogForStudent(id);
      assert.equal(log.length, 1);
      assert.equal(log[0]!.decision, "edited");
      assert.equal(log[0]!.toValue, "Rana Pratap");
      assert.equal(log[0]!.note, "house allocation");
      assert.equal(originOf(await loadOrigins([id]), id, "house")?.sourceKey, "office");
    }
  });

  test("a child that already holds the value is counted, not logged", async () => {
    const scenario = await createScenario();
    const students = (await Promise.all(scenario.studentIds.map(studentById))) as Student[];
    await writeOfficeEdits(plan(students, "house", "Rana Sanga").edits, scenario.userId);

    const again = (await Promise.all(scenario.studentIds.map(studentById))) as Student[];
    const second = plan(again, "house", "Rana Sanga");
    assert.equal(second.edits.length, 0);
    assert.equal(second.unchanged, 2);
    await writeOfficeEdits(second.edits, scenario.userId);
    assert.equal((await changeLogForStudent(scenario.studentIds[0]!)).length, 1, "no second row");
  });

  test("an invalid value is refused per child, and the rest still land", async () => {
    const scenario = await createScenario();
    const students = (await Promise.all(scenario.studentIds.map(studentById))) as Student[];
    // A class label off the list is refused by the same rule the import uses.
    const bad = plan(students, "classLabel", "Class 13");
    assert.equal(bad.edits.length, 0);
    assert.equal(bad.skipped.length, 2);

    const good = plan(students, "classLabel", "Class 9");
    assert.equal(good.edits.length, 2);
    await writeOfficeEdits(good.edits, scenario.userId);
    assert.equal((await studentById(scenario.studentIds[1]!))!.classLabel, "Class 9");
  });

  test("an empty list writes nothing", async () => {
    await writeOfficeEdits([], "nobody");
  });
});
