import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { cleanup, createFanOutScenario } from "./fixtures";
import { db, schema } from "../src/lib/db";
import {
  createBatch,
  getBatch,
  markSent,
  previewBatch,
  resumeBatch,
} from "../src/lib/batches";

/**
 * The fan-out, against the real database.
 *
 * What a mock could not tell you: that N links really are N rows with N distinct
 * tokens and N frozen rosters, that a partial run keeps what it made, and that
 * `requests_batch_scope_idx` actually stops a second Resume from minting a
 * duplicate. Those are database facts.
 */

before(cleanup);
after(cleanup);

function futureDate(): string {
  return new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
}

async function requestsIn(batchId: string) {
  return db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.batchId, batchId));
}

async function rosterOf(requestId: string) {
  const rows = await db
    .select({ studentId: schema.requestStudents.studentId })
    .from(schema.requestStudents)
    .where(eq(schema.requestStudents.requestId, requestId));
  return rows.map((row) => row.studentId).sort();
}

describe("previewing a bulk send", () => {
  test("reports the links and children it would create, without creating any", async () => {
    const scenario = await createFanOutScenario();

    const preview = await previewBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    assert.equal(preview.plan.totals.links, 2);
    assert.equal(preview.plan.totals.students, 4);
    assert.equal(preview.plan.blocked.length, 0);
    assert.equal(preview.audienceSize, 4);

    const created = await db
      .select()
      .from(schema.requests)
      .where(
        inArray(
          schema.requests.audienceLabel,
          scenario.groups.map((g) => g.classLabel),
        ),
      );
    assert.equal(created.length, 0, "a preview must not write anything");
  });

  test("refuses a selection that covers nobody rather than sending nothing quietly", async () => {
    const scenario = await createFanOutScenario();
    await assert.rejects(
      previewBatch({
        title: "Phone check",
        audience: { classes: ["ZZTEST-NOBODY-IS-IN-THIS"] },
        fieldKeys: ["phone"],
        dueDate: futureDate(),
        recipientMode: "class_teacher",
        createdBy: scenario.userId,
      }),
      /no active students/i,
    );
  });

  test("an empty audience selects nobody, never everybody", async () => {
    // The dangerous default. A missing filter must narrow to zero, not widen to
    // the whole school.
    const scenario = await createFanOutScenario();
    await assert.rejects(
      previewBatch({
        title: "Phone check",
        audience: {},
        fieldKeys: ["phone"],
        dueDate: futureDate(),
        recipientMode: "class_teacher",
        createdBy: scenario.userId,
      }),
      /no active students/i,
    );
  });
});

describe("creating a bulk send", () => {
  test("makes one link per group, each with its own token and frozen roster", async () => {
    const scenario = await createFanOutScenario();

    const result = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    assert.equal(result.failed, null);
    assert.equal(result.created.length, 2);

    const tokens = new Set(result.created.map((row) => row.token));
    assert.equal(tokens.size, 2, "every link needs its own token");

    const rows = await requestsIn(result.batchId);
    assert.equal(rows.length, 2);

    for (const group of scenario.groups) {
      const row = rows.find((r) => r.audienceLabel === group.classLabel)!;
      assert.ok(row, `no link for ${group.classLabel}`);
      assert.equal(row.teacherId, group.teacherId);
      assert.equal(row.audienceKind, "class");
      assert.equal(row.classLabel, group.classLabel);

      // Each teacher sees her own children and nobody else's.
      assert.deepEqual(await rosterOf(row.id), [...group.studentIds].sort());
    }
  });

  test("a house-wide link carries children from several classes on one token", async () => {
    const scenario = await createFanOutScenario({
      houses: ["Rana Pratap", "Rana Pratap"],
    });

    // One teacher is in-charge of the house; both classes' children are hers.
    await db
      .update(schema.teachers)
      .set({ houses: ["Rana Pratap"] })
      .where(eq(schema.teachers.id, scenario.groups[0]!.teacherId));

    const result = await createBatch({
      title: "House check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "house_incharge",
      createdBy: scenario.userId,
    });

    assert.equal(result.created.length, 1);

    const [row] = await requestsIn(result.batchId);
    assert.equal(row!.audienceKind, "house");
    assert.equal(row!.audienceLabel, "Rana Pratap");
    assert.equal(
      row!.classLabel,
      null,
      "a house link spans classes, so it claims none",
    );
    assert.deepEqual(
      await rosterOf(row!.id),
      scenario.groups.flatMap((g) => g.studentIds).sort(),
    );
  });

  test("children with no house are left out loudly, not silently", async () => {
    // A different house from the test above on purpose: class labels here are
    // fixture-scoped strings, but house names are the real four and shared, so
    // two tests claiming the same one would give it two in-charges and block it.
    const scenario = await createFanOutScenario({
      houses: ["Bappa Rawal", null],
    });
    await db
      .update(schema.teachers)
      .set({ houses: ["Bappa Rawal"] })
      .where(eq(schema.teachers.id, scenario.groups[0]!.teacherId));

    const preview = await previewBatch({
      title: "House check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "house_incharge",
      createdBy: scenario.userId,
    });

    assert.equal(preview.plan.totals.students, 2);
    assert.equal(preview.plan.unassigned.length, 2);
    assert.deepEqual(
      preview.plan.unassigned.map((row) => row.studentId).sort(),
      [...scenario.groups[1]!.studentIds].sort(),
    );
  });
});

describe("resuming a partial fan-out", () => {
  test("creates only what is missing and keeps what already exists", async () => {
    const scenario = await createFanOutScenario();

    const first = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    // Stand in for "link two of two failed": drop it and resume.
    const rows = await requestsIn(first.batchId);
    const casualty = rows.find(
      (row) => row.audienceLabel === scenario.groups[1]!.classLabel,
    )!;
    const survivor = rows.find((row) => row.id !== casualty.id)!;

    await db
      .delete(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, casualty.id));
    await db.delete(schema.requests).where(eq(schema.requests.id, casualty.id));

    const resumed = await resumeBatch(first.batchId, scenario.userId);

    assert.equal(resumed.created.length, 1, "only the missing group");
    assert.equal(
      resumed.created[0]!.scope.value,
      scenario.groups[1]!.classLabel,
    );

    const after = await requestsIn(first.batchId);
    assert.equal(after.length, 2);
    assert.ok(
      after.some((row) => row.id === survivor.id),
      "the link that already worked must survive untouched",
    );
    assert.equal(
      after.find((row) => row.id === survivor.id)!.token,
      survivor.token,
      "and must keep its token — it may already have been sent",
    );
  });

  test("resuming a finished batch is a no-op, not a second set of links", async () => {
    const scenario = await createFanOutScenario();

    const first = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    const again = await resumeBatch(first.batchId, scenario.userId);
    assert.equal(again.created.length, 0);
    assert.equal((await requestsIn(first.batchId)).length, 2);
  });
});

describe("the send queue", () => {
  test("tracks how many links have gone out, and lets a tick be taken back", async () => {
    const scenario = await createFanOutScenario();

    const result = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });

    const before = await getBatch(result.batchId);
    assert.equal(before!.links.length, 2);
    assert.equal(before!.sent, 0);
    assert.ok(before!.links.every((link) => link.rosterSize === 2));

    await markSent(result.created[0]!.requestId, scenario.userId, true);
    assert.equal((await getBatch(result.batchId))!.sent, 1);

    await markSent(result.created[0]!.requestId, scenario.userId, false);
    assert.equal(
      (await getBatch(result.batchId))!.sent,
      0,
      "the tick must be reversible — opening WhatsApp is not proof she sent it",
    );
  });
});
