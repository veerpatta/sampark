import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { compareClassLabels } from "./classes";
import { COMPLETENESS_COLUMNS } from "./completeness";
import type { MissingField } from "./students";
import { isoDayFrom, todayISO } from "./today";

/**
 * How full the school's records are, by class and by field, and how that has
 * moved.
 *
 * lib/completeness.ts scores one child. This is the same twelve fields over a
 * class at a time, which is the shape the office actually works in: "send the
 * Aadhaar round to the four classes that are worst on it" is a question about
 * a grid, not about five hundred rows.
 *
 * THE SHAPING FUNCTIONS ARE PURE and sit at the bottom, so the heatmap and the
 * trend can be tested without a database.
 */

export type CompletenessColumn = (typeof COMPLETENESS_COLUMNS)[number];

export type HealthRow = {
  classLabel: string;
  field: CompletenessColumn;
  filled: number;
  total: number;
};

/**
 * The twelve counts for every class, in ONE query.
 *
 * `count(*) filter (where …)` per column, grouped by class — the idiom
 * lib/students.ts already uses for the missing-field chips — then unpivoted
 * here into one row per (class, field). Active students only: a child who has
 * left is not a hole anyone is going to fill.
 */
export async function healthByClass(): Promise<HealthRow[]> {
  const counts = Object.fromEntries(
    COMPLETENESS_COLUMNS.map((column) => [
      column,
      sql<number>`count(*) filter (where nullif(btrim(${sql.identifier(column)}::text), '') is not null)::int`,
    ]),
  ) as Record<CompletenessColumn, ReturnType<typeof sql<number>>>;

  const rows = await db
    .select({
      classLabel: schema.students.classLabel,
      total: sql<number>`count(*)::int`,
      ...counts,
    })
    .from(schema.students)
    .where(eq(schema.students.status, "active"))
    .groupBy(schema.students.classLabel);

  const out: HealthRow[] = [];
  for (const row of rows) {
    for (const field of COMPLETENESS_COLUMNS) {
      out.push({
        classLabel: row.classLabel,
        field,
        filled: Number(row[field] ?? 0),
        total: Number(row.total),
      });
    }
  }
  return out.sort(
    (a, b) =>
      compareClassLabels(a.classLabel, b.classLabel) ||
      COMPLETENESS_COLUMNS.indexOf(a.field) - COMPLETENESS_COLUMNS.indexOf(b.field),
  );
}

/** Write one day's rows. Upsert on the primary key, so a re-run is harmless. */
export async function snapshotDay(day: string, rows: HealthRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    if (chunk.length === 0) continue;
    await db
      .insert(schema.completenessSnapshots)
      .values(chunk.map((row) => ({ day, ...row })))
      .onConflictDoUpdate({
        target: [
          schema.completenessSnapshots.day,
          schema.completenessSnapshots.classLabel,
          schema.completenessSnapshots.field,
        ],
        set: {
          filled: sql`excluded."filled"`,
          total: sql`excluded."total"`,
        },
      });
  }
}

export async function snapshotToday(now = new Date()): Promise<{ day: string; rows: number }> {
  const day = todayISO(now);
  const rows = await healthByClass();
  await snapshotDay(day, rows);
  return { day, rows: rows.length };
}

/**
 * Make sure today has a snapshot, without insisting on writing one.
 *
 * The cron writes at 06:30; the dashboard calls this on every render so a day
 * the cron missed — a paused project, a deploy at the wrong minute — still
 * gets its point on the trend from the first person to open the app.
 */
export async function ensureSnapshotToday(now = new Date()): Promise<boolean> {
  const day = todayISO(now);
  const [existing] = await db
    .select({ day: schema.completenessSnapshots.day })
    .from(schema.completenessSnapshots)
    .where(eq(schema.completenessSnapshots.day, day))
    .limit(1);
  if (existing) return false;
  await snapshotToday(now);
  return true;
}

export type TrendPoint = { day: string; filled: number; total: number; percent: number };

/** The school's total, one point per day, oldest first. */
export async function trend(days = 30, now = new Date()): Promise<TrendPoint[]> {
  const since = isoDayFrom(now, -days);
  const rows = await db
    .select({
      day: schema.completenessSnapshots.day,
      filled: sql<number>`sum(${schema.completenessSnapshots.filled})::int`,
      total: sql<number>`sum(${schema.completenessSnapshots.total})::int`,
    })
    .from(schema.completenessSnapshots)
    .where(gte(schema.completenessSnapshots.day, since))
    .groupBy(schema.completenessSnapshots.day)
    .orderBy(schema.completenessSnapshots.day);
  return rows.map((row) => toPoint(row.day, row.filled, row.total));
}

/** The same, per class. */
export async function trendByClass(
  days = 30,
  now = new Date(),
): Promise<Map<string, TrendPoint[]>> {
  const since = isoDayFrom(now, -days);
  const rows = await db
    .select({
      day: schema.completenessSnapshots.day,
      classLabel: schema.completenessSnapshots.classLabel,
      filled: sql<number>`sum(${schema.completenessSnapshots.filled})::int`,
      total: sql<number>`sum(${schema.completenessSnapshots.total})::int`,
    })
    .from(schema.completenessSnapshots)
    .where(and(gte(schema.completenessSnapshots.day, since)))
    .groupBy(schema.completenessSnapshots.day, schema.completenessSnapshots.classLabel)
    .orderBy(schema.completenessSnapshots.day);

  const out = new Map<string, TrendPoint[]>();
  for (const row of rows) {
    const series = out.get(row.classLabel) ?? [];
    series.push(toPoint(row.day, row.filled, row.total));
    out.set(row.classLabel, series);
  }
  return out;
}

/* ========================================================================== */
/*                          SHAPING — PURE FROM HERE                          */
/* ========================================================================== */

function toPoint(day: string, filled: number, total: number): TrendPoint {
  return { day, filled, total, percent: percentOf(filled, total) };
}

export function percentOf(filled: number, total: number): number {
  return total === 0 ? 0 : Math.round((filled / total) * 100);
}

export type HeatmapCell = { filled: number; total: number; percent: number };

export type Heatmap = {
  classes: string[];
  fields: CompletenessColumn[];
  cell: (classLabel: string, field: CompletenessColumn) => HeatmapCell;
  classTotal: (classLabel: string) => HeatmapCell;
  fieldTotal: (field: CompletenessColumn) => HeatmapCell;
  school: HeatmapCell;
};

const sum = (cells: { filled: number; total: number }[]): HeatmapCell => {
  const filled = cells.reduce((n, cell) => n + cell.filled, 0);
  const total = cells.reduce((n, cell) => n + cell.total, 0);
  return { filled, total, percent: percentOf(filled, total) };
};

/** Rows into a grid, with the margins summed. */
export function toHeatmap(rows: HealthRow[]): Heatmap {
  const classes = [...new Set(rows.map((row) => row.classLabel))].sort(compareClassLabels);
  const fields = [...COMPLETENESS_COLUMNS];
  const byKey = new Map(rows.map((row) => [`${row.classLabel}|${row.field}`, row]));
  const cell = (classLabel: string, field: CompletenessColumn): HeatmapCell => {
    const row = byKey.get(`${classLabel}|${field}`);
    return row
      ? { filled: row.filled, total: row.total, percent: percentOf(row.filled, row.total) }
      : { filled: 0, total: 0, percent: 0 };
  };
  return {
    classes,
    fields,
    cell,
    classTotal: (classLabel) => sum(fields.map((field) => cell(classLabel, field))),
    fieldTotal: (field) => sum(classes.map((classLabel) => cell(classLabel, field))),
    school: sum(rows),
  };
}

/** The n classes with the least complete records, worst first. */
export function worstClasses(
  rows: HealthRow[],
  n = 3,
): { classLabel: string; percent: number; filled: number; total: number }[] {
  const grid = toHeatmap(rows);
  return grid.classes
    .map((classLabel) => ({ classLabel, ...grid.classTotal(classLabel) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => a.percent - b.percent || compareClassLabels(a.classLabel, b.classLabel))
    .slice(0, n);
}

/**
 * What each heatmap cell links to on /students. Every tracked field has a
 * missing-filter, and a test says so — a cell that cannot be clicked is a
 * number the office has to go and find by hand.
 */
export const MISSING_FIELD_FOR: Record<CompletenessColumn, MissingField> = {
  phone: "phone",
  father_name: "father",
  mother_name: "mother",
  dob: "dob",
  gender: "gender",
  category: "category",
  aadhaar: "aadhaar",
  jan_aadhaar: "janAadhaar",
  village: "village",
  bus_route: "route",
  house: "house",
  photo_path: "photo",
};

/** How a column reads as a heading. Short, because there are twelve across. */
export const FIELD_HEADINGS: Record<CompletenessColumn, string> = {
  phone: "Mobile",
  father_name: "Father",
  mother_name: "Mother",
  dob: "DOB",
  gender: "Gender",
  category: "Category",
  aadhaar: "Aadhaar",
  jan_aadhaar: "Jan Aadhaar",
  village: "Village",
  bus_route: "Route",
  house: "House",
  photo_path: "Photo",
};
