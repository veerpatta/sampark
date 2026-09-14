import "../drizzle/env";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, like } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { listStudents } from "../src/lib/students";
import { healthByClass } from "../src/lib/data-health";
import { photoPathname } from "../src/lib/photos";
import { recordPhotoDefect, clearPhotoDefect } from "../src/lib/photo-marks";
import { cleanup, FIXTURE_PREFIX } from "./fixtures";

/**
 * "No photo" has to mean no photograph, in the database, against real SQL.
 *
 * The pure half of this lives in photo-health.test.ts. This is the half that
 * matters to the office: the chip she clicks, the count beside it, and the
 * heatmap cell above it are three separate queries, and before this they all
 * read `photo_path is null` and all agreed on the wrong answer. A child whose
 * upload was cut off was photographed according to every one of them.
 */

const CLASS = `${FIXTURE_PREFIX}PhotoGap`;
const GOOD = `${FIXTURE_PREFIX}PG1`;
const BROKEN = `${FIXTURE_PREFIX}PG2`;
const NONE = `${FIXTURE_PREFIX}PG3`;

const goodPath = photoPathname("S1001");
const brokenPath = photoPathname("S1002");

before(async () => {
  await db.insert(schema.students).values([
    { id: GOOD, name: "Test Child Good", classLabel: CLASS, photoPath: goodPath },
    { id: BROKEN, name: "Test Child Broken", classLabel: CLASS, photoPath: brokenPath },
    { id: NONE, name: "Test Child None", classLabel: CLASS },
  ]);
});

after(async () => {
  await db.delete(schema.students).where(like(schema.students.id, `${FIXTURE_PREFIX}%`));
  await cleanup();
});

describe("a photograph that will not open", () => {
  test("is marked against the pathname it was found on, and only then", async () => {
    const touched = await recordPhotoDefect(brokenPath, "truncated");
    assert.deepEqual(touched, [BROKEN]);

    const again = await recordPhotoDefect(brokenPath, "truncated");
    assert.deepEqual(again, [], "the same mark twice is not a second write");

    // The mark cannot land on a child who does not hold that photograph. This
    // is what makes a sweep racing a retake harmless.
    const stray = await recordPhotoDefect(photoPathname("S9999"), "missing");
    assert.deepEqual(stray, []);
  });

  test("is in the No photo filter, beside the child who never had one", async () => {
    const { students, total } = await listStudents({
      classes: [CLASS],
      missing: ["photo"],
    });
    const ids = students.map((row) => row.id).sort();
    assert.deepEqual(ids, [BROKEN, NONE].sort());
    assert.equal(total, 2, "the count above the board agrees with the rows in it");
  });

  test("does not count as a filled field on the heatmap", async () => {
    const rows = await healthByClass();
    const cell = rows.find((row) => row.classLabel === CLASS && row.field === "photo_path");
    assert.ok(cell, "the fixture class is on the grid");
    assert.equal(cell!.total, 3);
    assert.equal(cell!.filled, 1, "one of the three photographs actually opens");
  });

  test("sorts as the emptiest record, not as a complete one", async () => {
    const { students } = await listStudents({ classes: [CLASS], sort: "fullest" });
    assert.equal(
      students[0]!.id,
      GOOD,
      "the only child with a photograph anybody can open is the fullest record",
    );
  });

  test("comes back the moment a new photograph is attached", async () => {
    // No clean-up step anywhere: the mark names the old pathname, and a retake
    // mints a new one. This is that property, in the database.
    const replacement = photoPathname("S1002");
    await db
      .update(schema.students)
      .set({ photoPath: replacement })
      .where(eq(schema.students.id, BROKEN));

    const { students } = await listStudents({ classes: [CLASS], missing: ["photo"] });
    assert.deepEqual(
      students.map((row) => row.id),
      [NONE],
      "the stale mark names a photograph this child no longer has",
    );

    await db
      .update(schema.students)
      .set({ photoPath: brokenPath })
      .where(eq(schema.students.id, BROKEN));
  });

  test("is taken back when the photograph opens again", async () => {
    assert.deepEqual(await clearPhotoDefect(brokenPath), [BROKEN]);

    const { total } = await listStudents({ classes: [CLASS], missing: ["photo"] });
    assert.equal(total, 1, "only the child who never had one is left");

    assert.deepEqual(await clearPhotoDefect(brokenPath), [], "clearing twice is one write");
  });
});
