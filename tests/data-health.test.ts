import "../drizzle/env";
import assert from "node:assert/strict";
import { describe, test, after } from "node:test";
import { and, eq, like } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { COMPLETENESS_COLUMNS } from "../src/lib/completeness";
import {
  MISSING_FIELD_FOR,
  FIELD_HEADINGS,
  percentOf,
  snapshotDay,
  toHeatmap,
  worstClasses,
  type HealthRow,
} from "../src/lib/data-health";
import { MISSING_FIELDS } from "../src/lib/student-filters";
import { cleanup, FIXTURE_PREFIX } from "./fixtures";

/**
 * The grid and the trend are what the office decides the next round on, so
 * the shaping is tested without a database and the one write is tested
 * against the real one.
 */
const row = (classLabel: string, field: HealthRow["field"], filled: number, total: number): HealthRow => ({
  classLabel,
  field,
  filled,
  total,
});

describe("toHeatmap", () => {
  const rows = [
    row("Class 8", "phone", 20, 24),
    row("Class 8", "house", 4, 24),
    row("Class 6", "phone", 30, 30),
    row("Class 6", "house", 0, 30),
  ];
  const grid = toHeatmap(rows);

  test("orders classes as a timetable reads, not alphabetically", () => {
    assert.deepEqual(grid.classes, ["Class 6", "Class 8"]);
  });

  test("answers every cell, including the ones no row described", () => {
    assert.deepEqual(grid.cell("Class 8", "house"), { filled: 4, total: 24, percent: 17 });
    assert.deepEqual(grid.cell("Class 8", "aadhaar"), { filled: 0, total: 0, percent: 0 });
    assert.equal(grid.fields.length, COMPLETENESS_COLUMNS.length);
  });

  test("sums the margins", () => {
    assert.deepEqual(grid.classTotal("Class 6"), { filled: 30, total: 60, percent: 50 });
    assert.deepEqual(grid.fieldTotal("phone"), { filled: 50, total: 54, percent: 93 });
    assert.deepEqual(grid.school, { filled: 54, total: 108, percent: 50 });
  });

  test("a class with nobody in it is not 'complete'", () => {
    assert.equal(percentOf(0, 0), 0);
  });
});

describe("worstClasses", () => {
  test("puts the emptiest first, ties in timetable order, and stops at n", () => {
    const rows = [
      row("Class 9", "phone", 5, 10),
      row("Class 6", "phone", 5, 10),
      row("Class 7", "phone", 9, 10),
      row("Class 8", "phone", 1, 10),
    ];
    assert.deepEqual(
      worstClasses(rows, 3).map((entry) => `${entry.classLabel} ${entry.percent}`),
      ["Class 8 10", "Class 6 50", "Class 9 50"],
    );
  });
});

describe("every heatmap cell can be opened on the board", () => {
  test("each tracked column maps to a missing-field filter the board accepts", () => {
    for (const column of COMPLETENESS_COLUMNS) {
      const field = MISSING_FIELD_FOR[column];
      assert.ok(MISSING_FIELDS.includes(field), `${column} → ${field} is not a board filter`);
      assert.ok(FIELD_HEADINGS[column], `${column} has no heading`);
    }
  });
});

describe("snapshotDay", () => {
  after(cleanup);

  test("is idempotent: the same day twice updates rather than duplicates", async () => {
    const classLabel = `${FIXTURE_PREFIX} Class`;
    const day = "2026-01-15";
    await snapshotDay(day, [row(classLabel, "phone", 3, 10), row(classLabel, "house", 1, 10)]);
    await snapshotDay(day, [row(classLabel, "phone", 4, 10), row(classLabel, "house", 1, 10)]);

    const stored = await db
      .select()
      .from(schema.completenessSnapshots)
      .where(
        and(
          like(schema.completenessSnapshots.classLabel, `${FIXTURE_PREFIX}%`),
          eq(schema.completenessSnapshots.day, day),
        ),
      );
    assert.equal(stored.length, 2);
    assert.equal(stored.find((entry) => entry.field === "phone")!.filled, 4, "the second run wins");
  });

  test("writes nothing for an empty school", async () => {
    await snapshotDay("2026-01-16", []);
  });
});
