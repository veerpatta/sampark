import "../drizzle/env";
import assert from "node:assert/strict";
import { describe, test, after } from "node:test";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { listSharingPhone } from "../src/lib/students";
import { cleanup, createScenario, studentById } from "./fixtures";

/**
 * "Also on this number" — the card a parent's phone call opens.
 *
 * The lookup is hand-written SQL (a correlated EXISTS against the child's own
 * row) so it can run in the same wave as the student read rather than after
 * it. That is exactly the kind of query that returns quietly wrong rows, so
 * every rule it carries is asserted against a real database:
 *
 *   - the child is never their own sibling
 *   - a shared number matches whichever column it sits in
 *   - an EMPTY number is not a shared number. Imports have produced both null
 *     and '', and matching on '' would put every child with no mobile on every
 *     other such child's page.
 */
describe("listSharingPhone", () => {
  after(cleanup);

  test("finds the other child on the same number, and never the child itself", async () => {
    const scenario = await createScenario();
    const [one, two] = scenario.studentIds;

    /*
     * A NUMBER NO OTHER FIXTURE USES. `createScenario` gives its first child
     * 9111111111, and every test file's scenario does the same — so asserting
     * on that number found the other files' children too, and only when the
     * suite ran in parallel. The digits below appear in no fixture and no seed.
     */
    await db.update(schema.students).set({ phone: "9550000001" }).where(eq(schema.students.id, one!));
    await db.update(schema.students).set({ phone: "9550000001" }).where(eq(schema.students.id, two!));

    const siblings = await listSharingPhone(one!);
    assert.deepEqual(
      siblings.map((row) => row.id),
      [two],
      "the other child on that number, and only them",
    );
    assert.equal((await listSharingPhone(two!))[0]!.id, one, "and it works both ways");
  });

  test("matches across the two number columns", async () => {
    const scenario = await createScenario();
    const [one, two] = scenario.studentIds;
    // The mother's number on one child is the father's on the other.
    await db.update(schema.students).set({ phone: null, altPhone: "9550000002" }).where(eq(schema.students.id, one!));
    await db.update(schema.students).set({ phone: "9550000002" }).where(eq(schema.students.id, two!));

    assert.deepEqual((await listSharingPhone(one!)).map((r) => r.id), [two]);
  });

  test("an empty or missing number shares nothing", async () => {
    const scenario = await createScenario();
    const [one, two] = scenario.studentIds;
    await db.update(schema.students).set({ phone: "", altPhone: null }).where(eq(schema.students.id, one!));
    await db.update(schema.students).set({ phone: "", altPhone: null }).where(eq(schema.students.id, two!));

    assert.deepEqual(await listSharingPhone(one!), [], "'' is not a number two children share");

    await db.update(schema.students).set({ phone: null }).where(eq(schema.students.id, one!));
    assert.deepEqual(await listSharingPhone(one!), [], "and neither is null");
  });

  test("carries what the card draws, and a child who has left is still context", async () => {
    const scenario = await createScenario();
    const [one, two] = scenario.studentIds;
    await db
      .update(schema.students)
      .set({ phone: "9550000003", status: "left" })
      .where(eq(schema.students.id, two!));
    await db.update(schema.students).set({ phone: "9550000003" }).where(eq(schema.students.id, one!));

    const [sibling] = await listSharingPhone(one!);
    assert.ok(sibling, "a brother who left last year is still context for the sister who is here");
    assert.equal(sibling!.status, "left");
    // The fields the card renders — a missing one would be a blank row.
    const child = await studentById(two!);
    assert.equal(sibling!.name, child!.name);
    assert.equal(sibling!.classLabel, child!.classLabel);
  });
});
