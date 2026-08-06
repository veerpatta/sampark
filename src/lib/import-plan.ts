import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import {
  loadOrigins,
  loadPrecedence,
  mayWrite,
  originOf,
  recordOrigins,
  type OriginWrite,
  type Precedence,
  type SourceKey,
} from "./precedence";
import { STUDENT_COLUMN_BY_DB_NAME } from "./student-columns";
import type { Student } from "../../drizzle/schema";

/**
 * One writer for every import, going through precedence.
 *
 * Before this existed, each new file got its own importer and the third one
 * silently overwrote what the second one got right. Now an import declares
 * WHICH SOURCE IT IS and offers values; precedence decides which are allowed to
 * land, and every value that lands is stamped with where it came from.
 *
 * The outcome the office most needs to see is `skippedLowerPrecedence`. A
 * well-meaning re-import of last term's PSP export must not undo a month of
 * approved teacher corrections, and the way you know it didn't is that the
 * dry-run says so out loud rather than reporting a clean run that changed
 * nothing.
 */

/** One student's worth of incoming values, keyed by students COLUMN name. */
export type IncomingRow = {
  studentId: string;
  values: Record<string, string | null>;
  /** Only used when the student does not exist yet. */
  insertDefaults?: Record<string, string | null>;
  warnings?: string[];
};

export type FieldOutcome = {
  fieldKey: string;
  from: string | null;
  to: string | null;
  /** Present when the value was refused. */
  blockedBy?: string;
};

export type PlannedRow = {
  studentId: string;
  outcome: "insert" | "update" | "skip" | "blocked" | "error";
  changes: FieldOutcome[];
  /** Values refused because a higher-precedence source owns them. */
  blocked: FieldOutcome[];
  warnings: string[];
  message?: string;
};

export type ImportOutcomes = {
  insert: number;
  update: number;
  /** Nothing to do — every incoming value already matches. */
  skip: number;
  /** At least one value refused because something outranks this source. */
  blocked: number;
  error: number;
};

export type SourcedPlan = {
  sourceKey: SourceKey;
  rows: PlannedRow[];
  counts: ImportOutcomes;
  /** Students in the file that are not in the master record at all. */
  unmatched: string[];
  writes: {
    inserts: Record<string, unknown>[];
    updates: { id: string; values: Record<string, unknown> }[];
    origins: OriginWrite[];
  };
};

/**
 * Work out what a source's file would do, without doing any of it.
 *
 * `allowInsert` is false for a file that describes students it does not own —
 * the election list knows a name and a house and nothing else, and creating a
 * student record from that would produce a child with no class and no SR
 * number.
 */
export async function planSourcedImport(
  sourceKey: SourceKey,
  incoming: IncomingRow[],
  options: { allowInsert: boolean },
): Promise<SourcedPlan> {
  const ids = [...new Set(incoming.map((row) => row.studentId))];

  const [precedence, origins, existing] = await Promise.all([
    loadPrecedence(),
    loadOrigins(ids),
    loadStudents(ids),
  ]);

  const byId = new Map(existing.map((student) => [student.id, student]));

  const rows: PlannedRow[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const originWrites: OriginWrite[] = [];
  const unmatched: string[] = [];

  for (const row of incoming) {
    const student = byId.get(row.studentId);
    const warnings = [...(row.warnings ?? [])];

    if (!student) {
      unmatched.push(row.studentId);
      if (!options.allowInsert) {
        rows.push({
          studentId: row.studentId,
          outcome: "error",
          changes: [],
          blocked: [],
          warnings,
          message: "Not in the master record, and this source cannot create students",
        });
        continue;
      }

      const values = { ...row.insertDefaults, ...row.values };
      const insert: Record<string, unknown> = { id: row.studentId };
      const changes: FieldOutcome[] = [];

      for (const [column, value] of Object.entries(values)) {
        if (value === null || value === "") continue;
        const property = STUDENT_COLUMN_BY_DB_NAME.get(column);
        if (!property) continue;
        insert[property] = value;
        changes.push({ fieldKey: column, from: null, to: value });
        originWrites.push({ studentId: row.studentId, fieldKey: column, sourceKey });
      }

      inserts.push(insert);
      rows.push({
        studentId: row.studentId,
        outcome: "insert",
        changes,
        blocked: [],
        warnings,
      });
      continue;
    }

    const { changes, blocked, update, unclaimed } = diffAgainstPrecedence(
      student,
      row.values,
      sourceKey,
      precedence,
      origins,
    );

    for (const change of changes) {
      originWrites.push({
        studentId: row.studentId,
        fieldKey: change.fieldKey,
        sourceKey,
      });
    }

    // Values that already match and carry no provenance. This source is
    // demonstrably where they came from, so claim them — otherwise they stay
    // unowned and the next import overwrites them, which is exactly what this
    // module exists to stop. Also what repairs a run that wrote values and then
    // failed before stamping.
    for (const fieldKey of unclaimed) {
      originWrites.push({ studentId: row.studentId, fieldKey, sourceKey });
    }

    if (Object.keys(update).length > 0) {
      updates.push({ id: student.id, values: update });
      rows.push({
        studentId: row.studentId,
        outcome: "update",
        changes,
        blocked,
        warnings,
      });
    } else if (blocked.length > 0) {
      rows.push({
        studentId: row.studentId,
        outcome: "blocked",
        changes: [],
        blocked,
        warnings,
      });
    } else {
      rows.push({
        studentId: row.studentId,
        outcome: "skip",
        changes: [],
        blocked: [],
        warnings,
      });
    }
  }

  const counts: ImportOutcomes = {
    insert: 0,
    update: 0,
    skip: 0,
    blocked: 0,
    error: 0,
  };
  for (const row of rows) counts[row.outcome] += 1;

  return {
    sourceKey,
    rows,
    counts,
    unmatched,
    writes: { inserts, updates, origins: originWrites },
  };
}

/**
 * Compare one student's incoming values against what is stored, asking
 * precedence about each.
 *
 * A blank incoming value means "this source has nothing to say", never "erase".
 * Same rule the fee-app importer already follows, and the reason it matters
 * more here: PSP has no value for `village` at all, and a blank-means-erase
 * reading would wipe every village a teacher has collected.
 */
function diffAgainstPrecedence(
  student: Student,
  values: Record<string, string | null>,
  sourceKey: string,
  precedence: Precedence,
  origins: Awaited<ReturnType<typeof loadOrigins>>,
) {
  const changes: FieldOutcome[] = [];
  const blocked: FieldOutcome[] = [];
  const update: Record<string, unknown> = {};
  /** Fields already holding this value but with nobody claiming them. */
  const unclaimed: string[] = [];

  for (const [column, incomingValue] of Object.entries(values)) {
    if (incomingValue === null || incomingValue === "") continue;

    const property = STUDENT_COLUMN_BY_DB_NAME.get(column);
    if (!property) continue;

    const current = student[property as keyof Student];
    const currentText =
      current === null || current === undefined ? null : String(current);
    if (currentText === incomingValue) {
      if (!originOf(origins, student.id, column)) unclaimed.push(column);
      continue;
    }

    const verdict = mayWrite(
      column,
      sourceKey,
      originOf(origins, student.id, column),
      precedence,
    );

    if (!verdict.write) {
      blocked.push({
        fieldKey: column,
        from: currentText,
        to: incomingValue,
        blockedBy: verdict.reason,
      });
      continue;
    }

    changes.push({ fieldKey: column, from: currentText, to: incomingValue });
    update[property] = incomingValue;
  }

  return { changes, blocked, update, unclaimed };
}

/** Write a plan. Called only after the office has seen it and confirmed. */
export async function applySourcedPlan(plan: SourcedPlan): Promise<{
  inserted: number;
  updated: number;
}> {
  const { inserts, updates, origins } = plan.writes;

  for (const chunk of chunked(inserts, 100)) {
    await db
      .insert(schema.students)
      .values(chunk as (typeof schema.students.$inferInsert)[]);
  }

  for (const chunk of chunked(updates, 25)) {
    const statements = chunk.map((write) =>
      db
        .update(schema.students)
        .set({ ...write.values, updatedAt: new Date() })
        .where(eq(schema.students.id, write.id)),
    );
    await db.batch(
      statements as [(typeof statements)[number], ...typeof statements],
    );
  }

  // Provenance last, and only for values that actually landed. A value stamped
  // but not written would claim ground for a source that never took it.
  await recordOrigins(origins);

  return { inserted: inserts.length, updated: updates.length };
}

async function loadStudents(ids: string[]): Promise<Student[]> {
  const found: Student[] = [];
  for (const chunk of chunked(ids, 200)) {
    found.push(
      ...(await db
        .select()
        .from(schema.students)
        .where(inArray(schema.students.id, chunk))),
    );
  }
  return found;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
