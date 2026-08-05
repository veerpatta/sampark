import { randomBytes } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { FieldDef } from "../../../drizzle/schema";

/**
 * ============================================================================
 * THE ONE PLACE AUTHORIZATION LIVES.
 * ============================================================================
 *
 * Neon gives us no row-level security and no anonymous API surface, so every
 * teacher-facing read and write is scoped here and nowhere else. A bug in this
 * file is the expensive kind. It gets tests (Phase 6) and it gets reviewed
 * carefully. See SAMPARK_BUILD_PLAN.md sections 3 and 5.
 *
 * A token resolves to exactly one request -> one class -> one field set.
 * There is no menu, no navigation, and no way to reach another class.
 */

/** Grace period after due_date during which a link still opens. */
export const GRACE_DAYS = 3;

/**
 * 12 random bytes -> 16 url-safe characters -> ~96 bits of entropy.
 * Combined with rate limiting this makes enumeration infeasible.
 */
export function generateToken(): string {
  return randomBytes(12).toString("base64url");
}

export type TokenRejection = "not_found" | "expired" | "closed";

export type TokenCheckInput = {
  status: string; // open | submitted | closed | expired
  dueDate: string | Date;
};

export type TokenCheckResult =
  | { ok: true }
  | { ok: false; reason: TokenRejection };

/**
 * Pure predicate over a request row. Kept separate from the database read so it
 * can be unit tested without a connection.
 *
 * `now` is injectable so expiry tests do not depend on the wall clock.
 *
 * The optional PIN from plan section 5 was removed on request — see the note on
 * `requests` in drizzle/schema.ts. What is left is the whole gate: an open
 * request, inside its due date plus the grace period.
 */
export function checkRequestAccess(
  request: TokenCheckInput,
  now: Date = new Date(),
): TokenCheckResult {
  if (request.status === "closed" || request.status === "expired") {
    return { ok: false, reason: "closed" };
  }

  const due =
    typeof request.dueDate === "string"
      ? new Date(`${request.dueDate}T23:59:59+05:30`)
      : request.dueDate;

  const hardStop = new Date(due.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  if (now > hardStop) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true };
}

/* ========================================================================== */

/** One row on the teacher's phone, exactly as it was frozen at send time. */
export type ResolvedRosterRow = {
  studentId: string;
  rollNo: number | null;
  name: string;
  fatherName: string | null;
  values: Record<string, string | null>;
};

export type ResolvedRequest = {
  requestId: string;
  title: string;
  classLabel: string;
  period: string | null;
  dueDate: string;
  status: string;
  teacherName: string;
  fields: FieldDef[];
  roster: ResolvedRosterRow[];
};

/**
 * Resolve a token to exactly one request, one class and one field set.
 *
 * Returns null for EVERY rejection — unknown token, expired, closed. The caller
 * renders an identical 404 in all cases. A response that distinguished
 * "expired" from "never existed" would confirm to anyone probing that a token
 * was real, which is the first half of an attack.
 *
 * The roster is read from `request_students`, never recomputed from `students`.
 * The teacher must see what she was sent.
 */
export async function resolveToken(
  token: string,
  now: Date = new Date(),
): Promise<ResolvedRequest | null> {
  // A token is 16 base64url characters. Anything else cannot be one, and
  // bailing here keeps junk out of the query.
  if (!/^[A-Za-z0-9_-]{16}$/.test(token)) return null;

  const [row] = await db
    .select({ request: schema.requests, teacher: schema.teachers })
    .from(schema.requests)
    .innerJoin(
      schema.teachers,
      eq(schema.teachers.id, schema.requests.teacherId),
    )
    .where(eq(schema.requests.token, token))
    .limit(1);

  if (!row) return null;

  const access = checkRequestAccess(
    { status: row.request.status, dueDate: row.request.dueDate },
    now,
  );
  if (!access.ok) return null;

  const [fields, roster] = await Promise.all([
    db
      .select()
      .from(schema.fieldDefs)
      .where(inArray(schema.fieldDefs.key, row.request.fieldKeys))
      .orderBy(asc(schema.fieldDefs.sortOrder)),
    db
      .select()
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, row.request.id))
      .orderBy(asc(schema.requestStudents.rollNo)),
  ]);

  // Keep the field order the request asked for, not the registry's, so the
  // columns on the phone match what the office picked.
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const ordered = row.request.fieldKeys
    .map((key) => byKey.get(key))
    .filter((field): field is FieldDef => Boolean(field));

  return {
    requestId: row.request.id,
    title: row.request.title,
    classLabel: row.request.classLabel,
    period: row.request.period,
    dueDate: row.request.dueDate,
    status: row.request.status,
    teacherName: row.teacher.name,
    fields: ordered,
    roster: roster.map((entry) => {
      const snapshot = entry.snapshot as {
        name?: string;
        fatherName?: string | null;
        values?: Record<string, string | null>;
      };
      return {
        studentId: entry.studentId,
        rollNo: entry.rollNo,
        name: snapshot.name ?? "",
        fatherName: snapshot.fatherName ?? null,
        values: snapshot.values ?? {},
      };
    }),
  };
}
