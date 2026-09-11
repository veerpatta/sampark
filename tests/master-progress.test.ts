import "../drizzle/env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { createBatch } from "../src/lib/batches";
import { listNonResponders, listRequests } from "../src/lib/requests";
import {
  answersFromRoundMates,
  coveredStudentsInRound,
  coveredStudentsQuery,
} from "../src/lib/answered";
import { listPendingReview } from "../src/lib/submissions";
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

/**
 * When both links answer the same child.
 *
 * Two ways into one box is a state this app did not have before the master
 * link, and the two things that must be true about it are opposite in shape:
 * the later answer must WIN in the review queue, and the earlier one must not
 * be re-uploaded by the phone that sent it.
 */
describe("two links answering the same child", () => {
  it("lets the later answer retire the earlier one", async () => {
    const scenario = await createFanOutScenario();
    const result = await createBatch({
      title: "Test supersede round",
      audience: { classes: [scenario.groups[0]!.classLabel] },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });
    assert.ok(result.master);
    const link = result.created[0]!;
    const child = scenario.groups[0]!.studentIds[0]!;

    // Her answer first, the office's second — which is the order a real round
    // produces, because the master pass happens at the end of one.
    await answer(link.requestId, child, "9111111111");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await answer(result.master.requestId, child, "9222222222");

    const queue = await listPendingReview();
    const mine = queue.filter(
      (item) => item.studentId === child && item.fieldKey === "phone",
    );
    assert.equal(mine.length, 2, "both rows are on record — nothing is deleted");

    const live = mine.filter((item) => !item.superseded);
    assert.equal(live.length, 1, "but only one is still standing");
    assert.equal(
      live[0]!.newValue,
      "9222222222",
      "and it is the office's, because it came later",
    );
    assert.equal(
      live[0]!.audienceKind,
      "master",
      "the queue can say which link it came through",
    );
  });

  it("does not let one round's answer retire another round's", async () => {
    // The reason the key is `batch_id ?? id` and not just (student, field): a
    // September correction must not reach back and reject an August one.
    const scenario = await createFanOutScenario();
    const shared = { 
      audience: { classes: [scenario.groups[0]!.classLabel] },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher" as const,
      createdBy: scenario.userId,
    };
    const first = await createBatch({ ...shared, title: "Test round one" });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await createBatch({ ...shared, title: "Test round two" });

    const child = scenario.groups[0]!.studentIds[0]!;
    await answer(first.created[0]!.requestId, child, "9333333333");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await answer(second.created[0]!.requestId, child, "9444444444");

    const queue = await listPendingReview();
    const mine = queue.filter(
      (item) => item.studentId === child && item.fieldKey === "phone",
    );
    assert.equal(
      mine.filter((item) => !item.superseded).length,
      2,
      "two rounds, two live proposals — neither retires the other",
    );
  });
});

describe("what a teacher's own link shows her about the office's work", () => {
  it("hands back what the round holds that she did not send", async () => {
    const scenario = await createFanOutScenario();
    const result = await createBatch({
      title: "Test round mates",
      audience: { classes: [scenario.groups[0]!.classLabel] },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });
    assert.ok(result.master);
    const link = result.created[0]!;
    const child = scenario.groups[0]!.studentIds[0]!;

    await answer(result.master.requestId, child, "9555555555");

    const mates = await answersFromRoundMates(link.requestId, result.batchId, [
      "phone",
    ]);
    assert.equal(
      mates.get(child)?.phone,
      "9555555555",
      "her link can see what the office collected",
    );

    // And the office's own link does not read its own work back as somebody
    // else's — a request is never its own round-mate.
    const own = await answersFromRoundMates(
      result.master.requestId,
      result.batchId,
      ["phone"],
    );
    assert.equal(own.get(child), undefined);
  });

  it("has nothing to say about a request with no round", async () => {
    const mates = await answersFromRoundMates("any-id", null, ["phone"]);
    assert.equal(mates.size, 0);
  });
});
