import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { cleanup, createFanOutScenario } from "./fixtures";
import { db, schema } from "../src/lib/db";
import { createBatch, markSent } from "../src/lib/batches";
import {
  collectedForBatch,
  listRequestBoard,
  listRequests,
} from "../src/lib/requests";
import { resolveToken } from "../src/lib/auth/token";
import { recordSubmissions, type StudentAnswer } from "../src/lib/submissions";

/**
 * A whole round, read back out of the database.
 *
 * The batched read is what a mock cannot check. Reading every link's roster and
 * every link's submissions in ONE query each — rather than six queries per link
 * — is what makes a thirty-eight link round downloadable at all, and it is also
 * exactly the shape that can quietly put one class's answers on another class's
 * sheet. That is the test that matters here.
 */

before(cleanup);
after(cleanup);

const futureDate = () =>
  new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

async function twoClassRound() {
  const scenario = await createFanOutScenario();
  const result = await createBatch({
    title: "Phone check",
    audience: { classes: scenario.groups.map((g) => g.classLabel) },
    fieldKeys: ["phone"],
    dueDate: futureDate(),
    recipientMode: "class_teacher",
    createdBy: scenario.userId,
  });
  return { scenario, batchId: result.batchId };
}

/**
 * Answer one group of a round, through the real submit path.
 *
 * Through resolveToken and recordSubmissions rather than by INSERT, so the
 * fixture cannot construct a state a teacher's phone could not produce.
 */
async function recordAgainst(
  batchId: string,
  classLabel: string,
  answer: StudentAnswer,
) {
  const link = (await listRequests({ batchId })).find(
    (row) => row.audienceLabel === classLabel,
  )!;
  const resolved = await resolveToken(link.token);
  await recordSubmissions(resolved!, [answer], null, `test-${link.id}`);
}

describe("collectedForBatch", () => {
  test("returns null for a round that does not exist", async () => {
    assert.equal(
      await collectedForBatch("00000000-0000-0000-0000-000000000000"),
      null,
    );
  });

  test("gives one group per link, in register order", async () => {
    const { batchId } = await twoClassRound();
    const collected = (await collectedForBatch(batchId))!;

    assert.ok(collected);
    assert.equal(collected.groups.length, 2);
    assert.equal(collected.batch.title, "Phone check");

    const labels = collected.groups.map((g) => g.link.audienceLabel);
    assert.deepEqual(
      labels,
      [...labels].sort((a, b) => a.localeCompare(b)),
      "groups must not come back in whatever order the rows arrived",
    );
  });

  test("carries every child on the frozen roster, answered or not", async () => {
    const { scenario, batchId } = await twoClassRound();
    const collected = (await collectedForBatch(batchId))!;

    for (const group of collected.groups) {
      const expected = scenario.groups.find(
        (g) => g.classLabel === group.link.audienceLabel,
      )!;
      assert.deepEqual(
        group.rows.map((row) => row.studentId).sort(),
        [...expected.studentIds].sort(),
        "a child who submitted nothing must still be a row",
      );
      for (const row of group.rows) {
        assert.equal(row.outcome, "no answer");
      }
    }
  });

  test("never puts one group's answers on another group's sheet", async () => {
    /*
     * THE TEST THIS FILE EXISTS FOR. The rosters and the submissions for every
     * link are read in one query each and then split by request id in memory.
     * Get that split wrong and one class's phone numbers land on another
     * class's sheet — which is invisible in the file and wrong in a way nobody
     * would think to check.
     */
    const { scenario, batchId } = await twoClassRound();
    const [first, second] = scenario.groups;

    await recordAgainst(batchId, first!.classLabel, {
      studentId: first!.studentIds[0]!,
      values: { phone: "9998887777" },
    });

    const collected = (await collectedForBatch(batchId))!;
    const answering = collected.groups.find(
      (g) => g.link.audienceLabel === first!.classLabel,
    )!;
    const other = collected.groups.find(
      (g) => g.link.audienceLabel === second!.classLabel,
    )!;

    assert.equal(
      answering.rows.find((r) => r.studentId === first!.studentIds[0])!.answered
        .phone,
      "9998887777",
    );
    assert.ok(
      other.rows.every((row) => row.answered.phone === null),
      "an answer leaked onto the other class's sheet",
    );
    assert.ok(
      other.rows.every((row) => row.outcome === "no answer"),
      "the other class was marked as having answered",
    );
  });

  test("shows what was sent beside what came back", async () => {
    const { scenario, batchId } = await twoClassRound();
    const [first] = scenario.groups;

    await recordAgainst(batchId, first!.classLabel, {
      studentId: first!.studentIds[0]!,
      values: { phone: "9998887777" },
    });

    const collected = (await collectedForBatch(batchId))!;
    const row = collected.groups
      .flatMap((g) => g.rows)
      .find((r) => r.studentId === first!.studentIds[0])!;

    // The fixture seeds 9111111111 on the first child of each class.
    assert.equal(row.sent.phone, "9111111111", "the frozen value is missing");
    assert.equal(row.answered.phone, "9998887777");
    assert.equal(row.outcome, "corrected");
  });

  test("narrows each sheet to the fields its own link asked for", async () => {
    // In subject mode a link asks for one fa_* key and its snapshot was frozen
    // to match. Handing every sheet the round's union would give a marks round
    // sixteen columns with fifteen blank.
    const { batchId } = await twoClassRound();
    const collected = (await collectedForBatch(batchId))!;

    for (const group of collected.groups) {
      assert.deepEqual(
        group.fields.map((field) => field.key),
        group.link.fieldKeys,
      );
    }
  });

  test("agrees with the board about how many answered", async () => {
    // Both come from listRequests on purpose: a file that disagreed with the
    // screen it was downloaded from would be the worst kind of wrong.
    const { scenario, batchId } = await twoClassRound();
    const [first] = scenario.groups;

    await recordAgainst(batchId, first!.classLabel, {
      studentId: first!.studentIds[0]!,
      values: { phone: "9998887777" },
    });

    const collected = (await collectedForBatch(batchId))!;
    const board = await listRequests({ batchId });

    for (const group of collected.groups) {
      const row = board.find((r) => r.id === group.link.id)!;
      assert.equal(group.link.studentsAnswered, row.studentsAnswered);
      assert.equal(group.link.rosterSize, row.rosterSize);
    }
  });

  test("still carries a link the office has archived", async () => {
    // An archived link collected real answers. A round exported after a sweep
    // must still be the whole round; the board is where archiving hides things.
    const { scenario, batchId } = await twoClassRound();
    const links = await listRequests({ batchId });

    await db
      .update(schema.requests)
      .set({ archivedAt: new Date() })
      .where(eq(schema.requests.id, links[0]!.id));

    const collected = (await collectedForBatch(batchId))!;
    assert.equal(collected.groups.length, scenario.groups.length);
    assert.ok(
      collected.groups.some((g) => g.link.archivedAt !== null),
      "the archived link fell out of the file",
    );
  });
});

describe("the board, against the real database", () => {
  test("shows a fan-out as one entry carrying every link", async () => {
    const { batchId } = await twoClassRound();
    const entries = await listRequestBoard();

    const entry = entries.find(
      (e) => e.kind === "batch" && e.batchId === batchId,
    );
    assert.ok(entry && entry.kind === "batch", "the round is not on the board");
    assert.equal(entry.groups, 2);
    assert.equal(entry.requestIds.length, 2);
    assert.equal(entry.title, "Phone check");
  });

  test("counts the links actually handed over", async () => {
    // sent_by is the office user who pressed Send, not the teacher it went to.
    const { scenario, batchId } = await twoClassRound();
    const links = await listRequests({ batchId });
    await markSent(links[0]!.id, scenario.userId, true);

    const entries = await listRequestBoard();
    const entry = entries.find(
      (e) => e.kind === "batch" && e.batchId === batchId,
    )!;
    assert.equal(entry.kind === "batch" && entry.sentCount, 1);
  });

  test("an archived link leaves the round's line until you ask for it", async () => {
    const { batchId } = await twoClassRound();
    const links = await listRequests({ batchId });
    await db
      .update(schema.requests)
      .set({ archivedAt: new Date() })
      .where(eq(schema.requests.id, links[0]!.id));

    const visible = (await listRequestBoard()).find(
      (e) => e.kind === "batch" && e.batchId === batchId,
    )!;
    assert.equal(visible.kind === "batch" && visible.groups, 1);
    assert.equal(visible.kind === "batch" && visible.archivedCount, 0);

    const withArchived = (
      await listRequestBoard({ includeArchived: true })
    ).find((e) => e.kind === "batch" && e.batchId === batchId)!;
    assert.equal(withArchived.kind === "batch" && withArchived.groups, 2);
    assert.equal(withArchived.kind === "batch" && withArchived.archivedCount, 1);
  });

  test("a wholly archived round is off the board, not lost", async () => {
    const { batchId } = await twoClassRound();
    for (const link of await listRequests({ batchId })) {
      await db
        .update(schema.requests)
        .set({ archivedAt: new Date() })
        .where(eq(schema.requests.id, link.id));
    }

    assert.ok(
      !(await listRequestBoard()).some(
        (e) => e.kind === "batch" && e.batchId === batchId,
      ),
      "an archived round is still on the default board",
    );
    assert.ok(
      (await listRequestBoard({ includeArchived: true })).some(
        (e) => e.kind === "batch" && e.batchId === batchId,
      ),
      "an archived round cannot be found at all",
    );
  });
});
