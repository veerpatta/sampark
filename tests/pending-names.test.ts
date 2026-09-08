import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { cleanup, createScenario } from "./fixtures";
import { db, schema } from "../src/lib/db";
import { listPendingByRequest } from "../src/lib/requests";

/**
 * The names in a pending list, as a teacher actually receives them.
 *
 * 483 of the school's 504 names are stored in capitals, because that is how the
 * fee app took them. titleCaseName exists so nothing shouts ANSHUL KUMAWAT at
 * anybody, and every other surface calls it — the students board, a child's
 * page, the review queue, search, the teacher's own roster.
 *
 * The three that render THIS list did not: the reminder message, the waiting
 * list, and the round's nudge card. All three read PendingStudent.name, so all
 * three were wrong at once, and the names went out to teachers in block
 * capitals. Doing it where the model is built is what makes one fix cover
 * three renderers — and this test is what stops a fourth renderer, or a
 * refactor of this query, quietly putting the capitals back.
 *
 * Against the real database, because the name comes off the frozen snapshot
 * and the point is the whole path from that JSON to the string a teacher reads.
 */

before(cleanup);
after(cleanup);

describe("names in a pending list", () => {
  test("come back title-cased, not as the fee app stored them", async () => {
    const scenario = await createScenario();
    const shouted = scenario.studentIds[0]!;

    // The snapshot is what the list reads — never the live master row. Setting
    // it directly is the only way to reproduce what 483 real rosters hold.
    await db
      .update(schema.requestStudents)
      .set({
        snapshot: sql`jsonb_set(${schema.requestStudents.snapshot}, '{name}', '"ANSHUL KUMAWAT"')`,
      })
      .where(
        and(
          eq(schema.requestStudents.requestId, scenario.requestId),
          eq(schema.requestStudents.studentId, shouted),
        ),
      );

    const pending = await listPendingByRequest([scenario.requestId]);
    const names = (pending.get(scenario.requestId) ?? []).map((row) => row.name);

    assert.ok(
      names.includes("Anshul Kumawat"),
      `expected a title-cased name, got ${JSON.stringify(names)}`,
    );
    assert.ok(
      !names.includes("ANSHUL KUMAWAT"),
      "the name reached a teacher in capitals",
    );
  });

  test("a name typed deliberately in mixed case is left alone", async () => {
    // titleCaseName bails on any lowercase letter, because such a name was
    // typed by a person and we have no business second-guessing it.
    const scenario = await createScenario();
    const student = scenario.studentIds[0]!;

    await db
      .update(schema.requestStudents)
      .set({
        snapshot: sql`jsonb_set(${schema.requestStudents.snapshot}, '{name}', '"d''Souza  Fernandes"')`,
      })
      .where(
        and(
          eq(schema.requestStudents.requestId, scenario.requestId),
          eq(schema.requestStudents.studentId, student),
        ),
      );

    const pending = await listPendingByRequest([scenario.requestId]);
    const names = (pending.get(scenario.requestId) ?? []).map((row) => row.name);
    assert.ok(names.includes("d'Souza  Fernandes"));
  });
});
