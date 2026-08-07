import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, isNull } from "drizzle-orm";
import { cleanup, createScenario, submissionsFor } from "./fixtures";
import { db, schema } from "../src/lib/db";
import { listRequests } from "../src/lib/requests";
import { recordSubmissions } from "../src/lib/submissions";

/**
 * Removing a finished request, and the wall that decides how.
 *
 * The office asked to be able to delete a closed request. One that collected
 * nothing really can be. One that collected answers cannot, and these tests pin
 * that down against the real database rather than against a comment — the
 * constraint is a foreign key plus a revoked grant, and both are the sort of
 * thing a later migration can quietly relax.
 *
 * Everything here is prefixed ZZTEST and torn down after. Run with `npm test`.
 */

before(cleanup);
after(cleanup);

describe("deleting a request that collected nothing", () => {
  test("removes the row and takes its frozen roster with it", async () => {
    const scenario = await createScenario();
    assert.equal((await submissionsFor(scenario.requestId)).length, 0);

    const rosterBefore = await db
      .select()
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, scenario.requestId));
    assert.ok(rosterBefore.length > 0, "fixture should freeze a roster");

    await db.delete(schema.requests).where(eq(schema.requests.id, scenario.requestId));

    const gone = await db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, scenario.requestId));
    assert.equal(gone.length, 0);

    // request_students cascades. If it ever stops, deleting would fail on the
    // foreign key instead and the button would break rather than orphan a row.
    const roster = await db
      .select()
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, scenario.requestId));
    assert.equal(roster.length, 0, "the frozen roster must go with the request");
  });
});

describe("deleting a request that collected answers", () => {
  test("is REFUSED by the database, which is why archiving exists", async () => {
    // The claim the whole feature rests on. submissions.request_id references
    // requests with no cascade, and app_rw has DELETE revoked on submissions
    // (drizzle/sql/grants.sql, Rule 4). A teacher's answer and the office's
    // decision on it are the two things this system exists to keep, so the
    // remove button archives instead — see removeRequest in the request page's
    // actions. If this test ever goes green by deleting successfully, that
    // protection has been lost.
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9222222222" } }],
      null,
    );
    assert.ok((await submissionsFor(scenario.requestId)).length > 0);

    await assert.rejects(
      () => db.delete(schema.requests).where(eq(schema.requests.id, scenario.requestId)),
      "a request holding submissions must not be deletable",
    );

    // And it is still there afterwards, not half-removed.
    const stillThere = await db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, scenario.requestId));
    assert.equal(stillThere.length, 1);
  });

  test("archiving hides it from the boards and keeps every answer", async () => {
    const scenario = await createScenario();
    const [first] = scenario.resolved.roster;

    await recordSubmissions(
      scenario.resolved,
      [{ studentId: first!.studentId, values: { phone: "9333333333" } }],
      null,
    );
    const before = (await submissionsFor(scenario.requestId)).length;

    await db
      .update(schema.requests)
      .set({ archivedAt: new Date() })
      .where(eq(schema.requests.id, scenario.requestId));

    const visible = await listRequests();
    assert.ok(
      !visible.some((row) => row.id === scenario.requestId),
      "an archived request must not appear on the boards",
    );

    const withArchived = await listRequests({ includeArchived: true });
    const found = withArchived.find((row) => row.id === scenario.requestId);
    assert.ok(found, "asking for archived rows must return it");
    assert.ok(found!.archivedAt instanceof Date);

    // The point of archiving rather than deleting.
    assert.equal((await submissionsFor(scenario.requestId)).length, before);
  });

  test("restoring clears the mark and the row comes back", async () => {
    const scenario = await createScenario();

    await db
      .update(schema.requests)
      .set({ archivedAt: new Date() })
      .where(eq(schema.requests.id, scenario.requestId));
    assert.ok(!(await listRequests()).some((r) => r.id === scenario.requestId));

    await db
      .update(schema.requests)
      .set({ archivedAt: null })
      .where(eq(schema.requests.id, scenario.requestId));

    const back = (await listRequests()).find((r) => r.id === scenario.requestId);
    assert.ok(back, "a restored request must be on the boards again");
    assert.equal(back!.archivedAt, null);
  });
});

describe("archivedAt", () => {
  test("defaults to null, so every existing request stays visible", async () => {
    // The migration adds a nullable column to a live table. If it defaulted to
    // anything else, every request in the school's database would vanish from
    // the dashboard the moment it ran.
    const scenario = await createScenario();
    const [row] = await db
      .select({ archivedAt: schema.requests.archivedAt })
      .from(schema.requests)
      .where(eq(schema.requests.id, scenario.requestId));
    assert.equal(row!.archivedAt, null);

    const live = await db
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(isNull(schema.requests.archivedAt));
    assert.ok(live.some((r) => r.id === scenario.requestId));
  });
});
