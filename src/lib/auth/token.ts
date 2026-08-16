import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
// Sits below this file on purpose — lib/requests.ts imports generateToken from
// here, so the shared "answered" rule cannot live there. See lib/answered.ts.
import { coveredStudentsQuery } from "../answered";
import { compareClassLabels, compareStudentNames } from "../classes";
import type { RosterSnapshot } from "../snapshots";
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
 * A REQUEST token resolves to exactly one request -> one group -> one field
 * set. There is no navigation past it and no way to reach another group.
 *
 * A TEACHER token resolves to a list of that one teacher's currently-open
 * requests and to nothing else — a menu of her own work. Every entry on it is
 * re-checked by checkRequestAccess, the same predicate a request token goes
 * through. Neither kind can reach another teacher's requests.
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
  /** The only identifier she can check against a paper register. */
  srNo: string | null;
  name: string;
  /** Real identifying context in a village school; present for about half. */
  route: string | null;
  /** A coloured chip — the field a child answers instantly. */
  house: string | null;
  /** Which class, for a house or route link whose roster spans several. */
  classLabel: string | null;
  fatherName: string | null;
  values: Record<string, string | null>;
  /**
   * A number already on record for a sibling of this child, when this child has
   * none. Offered as one tap, never prefilled. Frozen at send time like
   * everything else on this row.
   */
  siblingPhone: { name: string; phone: string } | null;
};

export type ResolvedRequest = {
  requestId: string;
  title: string;
  /**
   * The group this link is for, as it reads on her screen: "Class 8", "Rana
   * Pratap", "Amet City". Not necessarily a class — a house or route link
   * carries children from several.
   */
  audienceLabel: string;
  period: string | null;
  dueDate: string;
  status: string;
  teacherName: string;
  fields: FieldDef[];
  roster: ResolvedRosterRow[];
  /**
   * Every class this link covers, in timetable order.
   *
   * One entry for a class link. SEVERAL for a subject link, which merges every
   * class a teacher takes that subject for — Hemlata's Chemistry link is
   * eighty-four children from three registers — and for a house or route link,
   * whose roster spans the school by definition. The screen needs it to say
   * which register a name came from; nothing else can tell her.
   */
  classLabels: string[];
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
      .where(eq(schema.requestStudents.requestId, row.request.id)),
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
    audienceLabel: row.request.audienceLabel,
    period: row.request.period,
    dueDate: row.request.dueDate,
    status: row.request.status,
    teacherName: row.teacher.name,
    fields: ordered,
    /*
     * CLASS FIRST, THEN NAME.
     *
     * Name order alone is right for a class link and wrong for every link that
     * spans more than one. A subject link interleaved three registers into one
     * alphabetical run of eighty-four children, so no stretch of the screen
     * matched any list she had in front of her. Sorting by class first makes
     * the screen read the way her registers do; within a class the order is
     * unchanged.
     *
     * Not roll number: it is null for every one of the 504 real students, so
     * ordering by it left a class in whatever order Postgres happened to
     * return.
     */
    roster: roster
      .map((entry) => {
        // Every field is optional and defaulted: snapshots frozen before a
        // field was added to the shape are still on record and must still open.
        const snapshot = entry.snapshot as Partial<RosterSnapshot>;
        return {
          studentId: entry.studentId,
          srNo: snapshot.srNo ?? null,
          name: snapshot.name ?? "",
          route: snapshot.route ?? null,
          house: snapshot.house ?? null,
          classLabel: snapshot.classLabel ?? null,
          fatherName: snapshot.fatherName ?? null,
          values: snapshot.values ?? {},
          siblingPhone: snapshot.siblingPhone ?? null,
        };
      })
      .sort(
        (a, b) =>
          compareClassLabels(a.classLabel ?? "", b.classLabel ?? "") ||
          compareStudentNames(a.name, b.name),
      ),
    classLabels: [
      ...new Set(
        roster
          .map((entry) => (entry.snapshot as Partial<RosterSnapshot>).classLabel)
          .filter((label): label is string => Boolean(label)),
      ),
    ].sort(compareClassLabels),
  };
}

/* ========================================================================== */
/*                        THE DURABLE TEACHER LINK                            */
/* ========================================================================== */

/**
 * Fields a durable menu must never advertise.
 *
 * A round asking for these is exactly the round the plan flags as needing more
 * than a bearer token — "worth revisiting before an Aadhaar collection round".
 * Its own /r/ link still works and the office still hands it over one message
 * at a time; it simply never appears on a page that outlives the round.
 *
 * A SET IN CODE, not a column and not an office decision at send time. A
 * checkbox someone forgets to tick is a checkbox that has already failed.
 *
 * `photo` joins them for the same reason and with the same trade. A photo round
 * opens the camera on forty-six children, and a page that outlives the round is
 * the wrong place to advertise it — the durable link is deliberately uncached
 * so that revoking it works, and a photo round is exactly the kind that should
 * be revocable. Nothing is lost: the round runs on its own /r/ link.
 */
const NEVER_ON_TEACHER_PAGE = new Set([
  "aadhaar",
  "jan_aadhaar",
  "dob",
  "photo",
]);

/** Pure, so the rule can be tested without a database. */
export function isListableOnTeacherPage(fieldKeys: string[]): boolean {
  return !fieldKeys.some((key) => NEVER_ON_TEACHER_PAGE.has(key));
}

/** One row on her durable page. A summary — the roster stays behind /r/. */
export type TeacherPageItem = {
  /** The per-request token. Tapping goes to /r/<token>, entirely unchanged. */
  token: string;
  title: string;
  audienceKind: string;
  audienceLabel: string;
  fieldKeys: string[];
  period: string | null;
  dueDate: string;
  rosterSize: number;
  /** How many of that roster she has already answered for. */
  answered: number;
};

export type ResolvedTeacherPage = {
  teacherName: string;
  items: TeacherPageItem[];
};

/** The IST calendar date `days` before `now`, as YYYY-MM-DD. */
function isoDaysBefore(now: Date, days: number): string {
  const shifted = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    shifted,
  );
}

/**
 * Resolve a durable teacher token to whatever is currently open for her.
 *
 * Returns null for EVERY rejection — malformed, unknown, revoked, teacher
 * deactivated — exactly as resolveToken does, and the caller renders the same
 * 404. Nothing here may distinguish them.
 *
 * IT DOES NOT RETURN NULL FOR "SHE HAS NOTHING OPEN", and that is the one place
 * this deliberately differs. With resolveToken, "no such token" and "nothing
 * here" are the same fact about one request. Here they are different facts, and
 * 404-ing a teacher on a quiet week would teach her that her saved link is
 * broken — after which the whole point of the durable link is gone. It leaks
 * nothing: reaching a 200 already requires holding a live 16-character token.
 *
 * EVERY ACCEPT AND REJECT IS checkRequestAccess. The SQL below narrows only on
 * things authorization does not depend on — whose requests they are, whether
 * the office is still watching them, and a deliberately LOOSE date floor that
 * can only ever admit rows the pure predicate then re-checks.
 */
export async function resolveTeacherToken(
  token: string,
  now: Date = new Date(),
): Promise<ResolvedTeacherPage | null> {
  // The same shape guard as resolveToken, before any query runs.
  if (!/^[A-Za-z0-9_-]{16}$/.test(token)) return null;

  const [teacher] = await db
    .select({
      id: schema.teachers.id,
      name: schema.teachers.name,
      active: schema.teachers.active,
    })
    .from(schema.teachers)
    .where(eq(schema.teachers.linkToken, token))
    .limit(1);

  // A revoked link is a NULL column, so it cannot match a 16-character token
  // and we never reach here. An inactive teacher can, and is refused the same.
  if (!teacher || !teacher.active) return null;

  const rows = await db
    .select({
      id: schema.requests.id,
      token: schema.requests.token,
      title: schema.requests.title,
      audienceKind: schema.requests.audienceKind,
      audienceLabel: schema.requests.audienceLabel,
      fieldKeys: schema.requests.fieldKeys,
      period: schema.requests.period,
      dueDate: schema.requests.dueDate,
      status: schema.requests.status,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.teacherId, teacher.id),
        // Archived means the office has stopped looking at it. Its own /r/ link
        // still opens — that is unchanged — but a MENU should only offer what
        // somebody is still watching. This page is stricter than /r/ on purpose.
        isNull(schema.requests.archivedAt),
        // A LOOSE floor, and the direction matters. checkRequestAccess accepts
        // until dueDate 23:59:59 IST + GRACE_DAYS; taking an extra day here
        // guarantees this filter can only admit rows the pure predicate then
        // re-checks, never reject one it would have accepted. Tighten it and an
        // authorization decision has quietly moved into SQL.
        gte(schema.requests.dueDate, isoDaysBefore(now, GRACE_DAYS + 1)),
      ),
    )
    .orderBy(asc(schema.requests.dueDate), asc(schema.requests.createdAt));

  const open = rows.filter(
    (row) =>
      checkRequestAccess({ status: row.status, dueDate: row.dueDate }, now).ok &&
      isListableOnTeacherPage(row.fieldKeys),
  );

  if (open.length === 0) return { teacherName: teacher.name, items: [] };

  const ids = open.map((row) => row.id);
  const [sizes, answered] = await Promise.all([
    db
      .select({
        requestId: schema.requestStudents.requestId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.requestStudents)
      .where(inArray(schema.requestStudents.requestId, ids))
      .groupBy(schema.requestStudents.requestId),
    /*
     * THE SAME RULE THE OFFICE USES, and it did not used to be.
     *
     * This was `count(distinct student_id)` — "has any submission at all" — so
     * a teacher who had filled one of two boxes for every child was told her
     * list was finished. Her page said "46 / 46 · पूरा हो गया" in green while
     * /requests said 40 of 46 and somebody was chasing her for six she believed
     * she had already sent. It over-counted on a second axis too: a submission
     * for a field key the request no longer asks about counted here and does
     * not count there.
     *
     * Two screens disagreeing about one number is worse than either number
     * being wrong, because there is no way for her to tell which to believe.
     */
    coveredStudentsQuery(ids),
  ]);

  const sizeBy = new Map(sizes.map((row) => [row.requestId, row.n]));
  const answeredBy = new Map<string, number>();
  for (const row of answered) {
    answeredBy.set(row.requestId, (answeredBy.get(row.requestId) ?? 0) + 1);
  }

  return {
    teacherName: teacher.name,
    items: open.map((row) => ({
      token: row.token,
      title: row.title,
      audienceKind: row.audienceKind,
      audienceLabel: row.audienceLabel,
      fieldKeys: row.fieldKeys,
      period: row.period,
      dueDate: row.dueDate,
      rosterSize: sizeBy.get(row.id) ?? 0,
      answered: answeredBy.get(row.id) ?? 0,
    })),
  };
}
