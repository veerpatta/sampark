import "../drizzle/env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { createBatch } from "../src/lib/batches";
import { listNonResponders, listRequests } from "../src/lib/requests";
import { coveredStudentsInRound, coveredStudentsQuery } from "../src/lib/answered";
import {
  ensureOfficeRecipient,
  getOfficeRecipient,
  OFFICE_TEACHER_ID,
} from "../src/lib/office";
import { cleanup, createFanOutScenario } from "./fixtures";

/**
 * What a round reports when the office did some of it.
 *
 * THIS IS THE FILE THAT PINS THE TWO COVERAGE FUNCTIONS APART. lib/answered.ts
 * now holds two, and the whole risk of that change is somebody later deciding
 * they are duplicates and deleting one:
 *
 *   - coveredStudentsQuery  — what did THIS link collect. The export's question.
 *   - coveredStudentsInRound — does anybody still owe this. The chase's question.
 *
 * The last assertion in the first test asserts they DISAGREE, on purpose, over
 * the same data. If that assertion ever has to be relaxed, the two have been
 * collapsed into one and something is now lying — either the workbook claims the
 * class teacher collected what the office did, or the board reports a finished
 * class as empty and nineteen teachers get chased for work already done.
 */
let officeWasMine = false;

before(async () => {
  if (await getOfficeRecipient()) return;
  await ensureOfficeRecipient({ phone: "9000000001", name: "Test Office" });
  officeWasMine = true;
});

after(async () => {
  // Before the office row: requests.teacher_id has no cascade.
  await cleanup();
  if (officeWasMine) {
    await db.delete(schema.teachers).where(eq(schema.teachers.id, OFFICE_TEACHER_ID));
  }
});

function futureDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

/** One answer, written the way the teacher surface writes one. */
async function answer(requestId: string, studentId: string, value: string) {
  await db.insert(schema.submissions).values({
    requestId,
    studentId,
    fieldKey: "phone",
    action: "changed",
    oldValue: null,
    newValue: value,
  });
}

describe("a round where the office finished what a teacher did not", () => {
  it("counts the office's work for the class, without crediting the link", async () => {
    const scenario = await createFanOutScenario();
    const result = await createBatch({
      title: "Test progress round",
      audience: { classes: scenario.groups.map((group) => group.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    assert.ok(result.master, "the round has a master link");
    const first = result.created.find(
      (link) => link.scope.value === scenario.groups[0]!.classLabel,
    );
    assert.ok(first, "and a link for the first class");

    const [childA, childB] = scenario.groups[0]!.studentIds;

    // She did one child. The office did the other, through the master link.
    await answer(first.requestId, childA!, "9222222222");
    await answer(result.master.requestId, childB!, "9333333333");

    const board = await listRequests({ batchId: result.batchId });
    const row = board.find((entry) => entry.id === first.requestId);
    assert.ok(row);
    assert.equal(row.rosterSize, 2);
    assert.equal(
      row.studentsAnswered,
      2,
      "the class reads finished, because it is — one of the two was the office",
    );

    // The list the office chases FROM. Nobody in this class is still owed.
    const pending = await listNonResponders(first.requestId);
    assert.deepEqual(pending, [], "nobody is chased for a child already done");

    /*
     * AND THE OTHER DEFINITION STILL SAYS ONE. This is the assertion that keeps
     * the pair honest: over exactly the same rows, "what did this link collect"
     * is still one child, which is what the round's workbook must report.
     */
    const own = await coveredStudentsQuery([first.requestId]);
    assert.equal(own.length, 1, "this link itself collected one child");
    assert.equal(own[0]!.studentId, childA);

    const round = await coveredStudentsInRound([first.requestId]);
    assert.equal(round.length, 2, "the round collected both");
  });

  it("does not let one class's master answers finish another class", async () => {
    const scenario = await createFanOutScenario();
    const result = await createBatch({
      title: "Test roster scoping",
      audience: { classes: scenario.groups.map((group) => group.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });
    assert.ok(result.master);

    const second = result.created.find(
      (link) => link.scope.value === scenario.groups[1]!.classLabel,
    );
    assert.ok(second);

    // Both answers are about the FIRST class's children, through the master
    // link — whose roster spans both. Without the roster join in
    // coveredStudentsInRound these would count toward the second class and it
    // would read finished with both its own children still blank.
    for (const studentId of scenario.groups[0]!.studentIds) {
      await answer(result.master.requestId, studentId, "9444444444");
    }

    const board = await listRequests({ batchId: result.batchId });
    const other = board.find((entry) => entry.id === second.requestId);
    assert.ok(other);
    assert.equal(
      other.studentsAnswered,
      0,
      "the second class is untouched by work done on the first",
    );

    const stillPending = await listNonResponders(second.requestId);
    assert.equal(stillPending.length, 2, "and both its children are still owed");
  });

  it("leaves a round with no master link counting exactly as it always did", async () => {
    const scenario = await createFanOutScenario();
    const result = await createBatch({
      title: "Test ordinary round",
      audience: { classes: [scenario.groups[0]!.classLabel] },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    const link = result.created[0]!;
    await answer(link.requestId, scenario.groups[0]!.studentIds[0]!, "9555555555");

    // The two definitions agree whenever there is only one link answering, and
    // that is the case every round before this feature existed.
    const own = await coveredStudentsQuery([link.requestId]);
    const round = await coveredStudentsInRound([link.requestId]);
    assert.equal(own.length, 1);
    assert.equal(round.length, 1);
    assert.equal(own[0]!.studentId, round[0]!.studentId);
  });
});
