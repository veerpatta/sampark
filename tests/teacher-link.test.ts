import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { cleanup, createFanOutScenario } from "./fixtures";
import { db, schema } from "../src/lib/db";
import { createBatch, getBatch, markGroupSent } from "../src/lib/batches";
import {
  GRACE_DAYS,
  generateToken,
  isListableOnTeacherPage,
  resolveTeacherToken,
  resolveToken,
} from "../src/lib/auth/token";

/**
 * The durable teacher link, against the real database.
 *
 * This is the one token in the system that reaches more than one group, so the
 * tests that matter are the refusals. Every rejection must look identical from
 * the outside, and revocation must actually revoke.
 *
 * Everything is prefixed ZZTEST and torn down after. Run with `npm test`.
 */

before(cleanup);
after(cleanup);

const futureDate = (days = 5) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

/** Give a teacher a durable link and return it. */
async function giveLink(teacherId: string): Promise<string> {
  const token = generateToken();
  await db
    .update(schema.teachers)
    .set({ linkToken: token, linkIssuedAt: new Date() })
    .where(eq(schema.teachers.id, teacherId));
  return token;
}

async function makeRequest(
  scenario: Awaited<ReturnType<typeof createFanOutScenario>>,
  groupIndex: number,
  dueDate = futureDate(),
) {
  const group = scenario.groups[groupIndex]!;
  const result = await createBatch({
    title: "Phone check",
    audience: { classes: [group.classLabel] },
    fieldKeys: ["phone"],
    dueDate,
    recipientMode: "class_teacher",
    createdBy: scenario.userId,
  });
  return result.created[0]!;
}

describe("what the durable page lists", () => {
  test("her own open requests, and never another teacher's", async () => {
    const scenario = await createFanOutScenario();
    const mine = await makeRequest(scenario, 0);
    const hers = await makeRequest(scenario, 1);
    const token = await giveLink(scenario.groups[0]!.teacherId);

    const page = await resolveTeacherToken(token);
    assert.ok(page);
    assert.deepEqual(
      page!.items.map((item) => item.token),
      [mine.token],
    );
    assert.ok(
      !page!.items.some((item) => item.token === hers.token),
      "another teacher's request must never appear",
    );
  });

  test("a live token with nothing open is an empty page, NOT a 404", async () => {
    // 404-ing her on a quiet week teaches her the saved link is broken, after
    // which the whole point of a durable link is gone. It leaks nothing:
    // getting a 200 already requires holding a live 16-character token.
    const scenario = await createFanOutScenario();
    const token = await giveLink(scenario.groups[0]!.teacherId);

    const page = await resolveTeacherToken(token);
    assert.ok(page, "an empty page is still a page");
    assert.deepEqual(page!.items, []);
  });

  test("carries how far she has got, so the page is worth returning to", async () => {
    const scenario = await createFanOutScenario();
    const created = await makeRequest(scenario, 0);
    const token = await giveLink(scenario.groups[0]!.teacherId);

    const page = await resolveTeacherToken(token);
    assert.equal(page!.items[0]!.rosterSize, 2);
    assert.equal(page!.items[0]!.answered, 0);
    assert.equal(page!.items[0]!.token, created.token);
  });
});

describe("every rejection looks the same", () => {
  // Three separate assertions rather than a loop, so removing the discipline
  // means consciously deleting three lines.
  test("a malformed token is null", async () => {
    assert.equal(await resolveTeacherToken("nope"), null);
  });

  test("a well-formed token nobody holds is null", async () => {
    assert.equal(await resolveTeacherToken(generateToken()), null);
  });

  test("a revoked token is null", async () => {
    const scenario = await createFanOutScenario();
    await makeRequest(scenario, 0);
    const token = await giveLink(scenario.groups[0]!.teacherId);
    assert.ok(await resolveTeacherToken(token));

    await db
      .update(schema.teachers)
      .set({ linkToken: null, linkIssuedAt: null })
      .where(eq(schema.teachers.id, scenario.groups[0]!.teacherId));

    assert.equal(await resolveTeacherToken(token), null);
  });

  test("a deactivated teacher's live token is null", async () => {
    const scenario = await createFanOutScenario();
    await makeRequest(scenario, 0);
    const token = await giveLink(scenario.groups[0]!.teacherId);

    await db
      .update(schema.teachers)
      .set({ active: false })
      .where(eq(schema.teachers.id, scenario.groups[0]!.teacherId));

    assert.equal(await resolveTeacherToken(token), null);
  });
});

describe("rotation and revoke-all", () => {
  test("issuing a new link kills the old one in the same write", async () => {
    const scenario = await createFanOutScenario();
    await makeRequest(scenario, 0);
    const first = await giveLink(scenario.groups[0]!.teacherId);
    const second = await giveLink(scenario.groups[0]!.teacherId);

    assert.equal(await resolveTeacherToken(first), null, "the old URL must die");
    assert.ok(await resolveTeacherToken(second));
  });

  test("revoking every link leaves none of them resolving", async () => {
    const scenario = await createFanOutScenario();
    await makeRequest(scenario, 0);
    await makeRequest(scenario, 1);
    const a = await giveLink(scenario.groups[0]!.teacherId);
    const b = await giveLink(scenario.groups[1]!.teacherId);

    await db
      .update(schema.teachers)
      .set({ linkToken: null, linkIssuedAt: null })
      .where(eq(schema.teachers.id, scenario.groups[0]!.teacherId));
    await db
      .update(schema.teachers)
      .set({ linkToken: null, linkIssuedAt: null })
      .where(eq(schema.teachers.id, scenario.groups[1]!.teacherId));

    assert.equal(await resolveTeacherToken(a), null);
    assert.equal(await resolveTeacherToken(b), null);
  });
});

describe("the two resolvers agree, except where they must not", () => {
  test("an expired request drops off the page and off its own link together", async () => {
    const scenario = await createFanOutScenario();
    const created = await makeRequest(scenario, 0, futureDate(1));
    const token = await giveLink(scenario.groups[0]!.teacherId);

    const later = new Date(Date.now() + (GRACE_DAYS + 3) * 86400000);
    assert.equal(await resolveToken(created.token, later), null);

    const page = await resolveTeacherToken(token, later);
    assert.ok(page, "her page still opens");
    assert.deepEqual(page!.items, [], "but the dead request is not on it");
  });

  test("an ARCHIVED request leaves the page while its own link still opens", async () => {
    // The deliberate asymmetry. Archiving means the office has stopped watching
    // it, so a menu should not offer it — but a teacher mid-answer holding the
    // /r/ link must not have it die under her. Do not "fix" this.
    const scenario = await createFanOutScenario();
    const created = await makeRequest(scenario, 0);
    const token = await giveLink(scenario.groups[0]!.teacherId);

    await db
      .update(schema.requests)
      .set({ archivedAt: new Date() })
      .where(eq(schema.requests.id, created.requestId));

    const page = await resolveTeacherToken(token);
    assert.deepEqual(page!.items, [], "archived is off the menu");
    assert.ok(
      await resolveToken(created.token),
      "but its own link still opens",
    );
  });
});

describe("isListableOnTeacherPage", () => {
  test("an ordinary round lists", () => {
    assert.equal(isListableOnTeacherPage(["phone", "father_name"]), true);
    assert.equal(isListableOnTeacherPage(["fa_maths"]), true);
  });

  test("Aadhaar, Jan Aadhaar and date of birth never do", () => {
    // These rounds go out one message at a time, the way every round did before
    // durable links — no decision for anyone to remember.
    for (const key of ["aadhaar", "jan_aadhaar", "dob"]) {
      assert.equal(isListableOnTeacherPage([key]), false, key);
    }
  });

  test("one sensitive field is enough to keep the whole round off", () => {
    assert.equal(isListableOnTeacherPage(["phone", "aadhaar"]), false);
  });
});

describe("marking a grouped send", () => {
  test("ticks and unticks every link in one call", async () => {
    const scenario = await createFanOutScenario();
    const result = await createBatch({
      title: "Phone check",
      audience: { classes: scenario.groups.map((g) => g.classLabel) },
      fieldKeys: ["phone"],
      dueDate: futureDate(),
      recipientMode: "class_teacher",
      createdBy: scenario.userId,
    });
    const ids = result.created.map((row) => row.requestId);
    assert.equal(ids.length, 2);

    await markGroupSent(ids, scenario.userId, true);
    assert.equal((await getBatch(result.batchId))!.sent, 2);

    await markGroupSent(ids, scenario.userId, false);
    assert.equal(
      (await getBatch(result.batchId))!.sent,
      0,
      "a grouped tick must be as reversible as a single one",
    );
  });

  test("does nothing, and does not throw, on an empty list", async () => {
    await markGroupSent([], "nobody", true);
  });
});
