import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema, withTransaction } from "./db";
import { validateField } from "./fields";
import { teacherOrigin, type OriginWrite } from "./precedence";
import { STUDENT_COLUMN_BY_DB_NAME } from "./student-columns";
import type { ResolvedRequest } from "./auth/token";
import type { FieldDef } from "../../drizzle/schema";

/**
 * Teacher submissions, and the review path that turns them into master data.
 *
 * Two rules from the plan govern everything here:
 *
 *   Rule 3 — every teacher submission is a PROPOSED change. Nothing reaches the
 *   students table without an explicit approval carrying a user id and a
 *   timestamp.
 *
 *   Rule 8 — the client is never trusted. The browser tells us what the teacher
 *   typed and nothing more. Which action that amounts to — confirmed, changed,
 *   not_present — is decided HERE, by comparing against the frozen snapshot.
 *   A client that claims "confirmed" while sending a different value gets a
 *   'changed' row, because the comparison is ours.
 */

export type StudentAnswer = {
  studentId: string;
  notPresent?: boolean;
  /** Keyed by field_defs.key. A missing key means "unchanged". */
  values?: Record<string, string | null>;
};

export type RecordResult = {
  recorded: number;
  changed: number;
  confirmed: number;
  notPresent: number;
};

export type ValidationFailure = {
  studentId: string;
  fieldKey: string;
  error: string;
  errorHi: string;
};

export class SubmissionValidationError extends Error {
  constructor(public readonly failures: ValidationFailure[]) {
    super("Some answers did not pass validation");
    this.name = "SubmissionValidationError";
  }
}

/**
 * Write one submission row per (student, field) the teacher answered for.
 *
 * Students not in the frozen roster are ignored rather than rejected: the
 * roster is the scope of the token, and a payload naming someone outside it is
 * either a stale tab or someone probing. Neither deserves a helpful error.
 */
export async function recordSubmissions(
  request: ResolvedRequest,
  answers: StudentAnswer[],
  clientHash: string | null,
  idempotencyKey: string | null = null,
): Promise<RecordResult> {
  const roster = new Map(request.roster.map((row) => [row.studentId, row]));
  const failures: ValidationFailure[] = [];

  type Row = typeof schema.submissions.$inferInsert;
  const rows: Row[] = [];

  for (const answer of answers) {
    const student = roster.get(answer.studentId);
    if (!student) continue;

    for (const field of request.fields) {
      const frozen = normalise(field, student.values[field.key] ?? null);

      if (answer.notPresent) {
        rows.push({
          requestId: request.requestId,
          studentId: student.studentId,
          fieldKey: field.key,
          action: "not_present",
          oldValue: frozen,
          newValue: null,
          reviewStatus: "pending",
          clientHash,
        });
        continue;
      }

      const supplied = answer.values?.[field.key];
      // An absent key means the teacher left the row alone: that is a
      // confirmation of what we showed her, not a blank.
      if (supplied === undefined) {
        rows.push(confirmation(request, student.studentId, field, frozen, clientHash));
        continue;
      }

      const checked = validateField(field, supplied);
      if (!checked.ok) {
        failures.push({
          studentId: student.studentId,
          fieldKey: field.key,
          error: checked.error,
          errorHi: checked.errorHi,
        });
        continue;
      }

      // Blank means "no change", never "erase" — the same rule the importer
      // follows. A teacher has no way to say "this value should be empty", and
      // silently emptying a parent's phone number because a field was cleared
      // by accident is not a mistake we can detect later.
      if (checked.value === null) {
        rows.push(confirmation(request, student.studentId, field, frozen, clientHash));
        continue;
      }

      if (checked.value === frozen) {
        rows.push(confirmation(request, student.studentId, field, frozen, clientHash));
        continue;
      }

      rows.push({
        requestId: request.requestId,
        studentId: student.studentId,
        fieldKey: field.key,
        action: "changed",
        oldValue: frozen,
        newValue: checked.value,
        reviewStatus: "pending",
        clientHash,
      });
    }
  }

  if (failures.length > 0) throw new SubmissionValidationError(failures);
  if (rows.length === 0) {
    return { recorded: 0, changed: 0, confirmed: 0, notPresent: 0 };
  }

  for (const row of rows) row.idempotencyKey = idempotencyKey;

  // ON CONFLICT DO NOTHING against the (idempotency_key, student_id, field_key)
  // unique index. A teacher on a bad signal taps send, sees nothing happen, and
  // taps again — this makes the second attempt a no-op instead of a second set
  // of pending changes for the office to wade through. A NULL key (anything
  // written before Phase 5) never collides, because Postgres treats NULLs in a
  // unique index as distinct.
  for (let i = 0; i < rows.length; i += 200) {
    await db
      .insert(schema.submissions)
      .values(rows.slice(i, i + 200))
      .onConflictDoNothing();
  }

  return {
    recorded: rows.length,
    changed: rows.filter((row) => row.action === "changed").length,
    confirmed: rows.filter((row) => row.action === "confirmed").length,
    notPresent: rows.filter((row) => row.action === "not_present").length,
  };
}

/**
 * A confirmation that matches the snapshot is not a reviewable change.
 *
 * It lands with review_status 'auto' so it never appears in the queue — the
 * office should only ever be asked to look at things that actually differ.
 * The row is still written, because "she checked it and it was right" is the
 * single most useful fact this system collects.
 */
function confirmation(
  request: ResolvedRequest,
  studentId: string,
  field: FieldDef,
  frozen: string | null,
  clientHash: string | null,
): typeof schema.submissions.$inferInsert {
  return {
    requestId: request.requestId,
    studentId,
    fieldKey: field.key,
    action: "confirmed",
    oldValue: frozen,
    newValue: frozen,
    reviewStatus: "auto",
    clientHash,
  };
}

/** Put a stored value through the same validator, so comparison is like for like. */
function normalise(field: FieldDef, value: string | null): string | null {
  if (value === null || value === "") return null;
  const checked = validateField(field, value);
  return checked.ok ? checked.value : value;
}

/**
 * A coarse device fingerprint for anti-abuse only, never for identification.
 * Derived server-side from the connection: a value the browser supplies could
 * simply be made up, which would make it worse than useless.
 */
export function clientFingerprint(ip: string, userAgent: string | null): string {
  return createHash("sha256")
    .update(`${ip}|${userAgent ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/* ========================================================================== */
/*                                   REVIEW                                   */
/* ========================================================================== */

export type ReviewItem = {
  id: string;
  requestId: string;
  requestTitle: string;
  /** The group the link was for: a class, a house or a bus route. */
  audienceLabel: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  rollNo: number | null;
  fieldKey: string;
  fieldLabel: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  submittedAt: Date;
  /** True when a later submission for the same student and field exists. */
  superseded: boolean;
  /**
   * How many OTHER active students already hold this same number.
   *
   * Neutral information for the office, and nothing more. 134 numbers in this
   * school are shared by more than one student and 133 of those span more than
   * one class, because siblings share a parent's phone. It is never a warning,
   * never blocks an approval, and is never shown to a teacher — see the note in
   * lib/fields.ts.
   */
  alsoOn: number;
};

/**
 * The approval queue.
 *
 * Re-submission is allowed until a request is closed, so the same student and
 * field can have several pending rows. Only the newest is actionable; the
 * earlier ones are marked superseded and hidden by default, and approving the
 * newest resolves them in the same transaction.
 */
export async function listPendingReview(requestId?: string): Promise<ReviewItem[]> {
  const where = requestId
    ? and(
        eq(schema.submissions.reviewStatus, "pending"),
        eq(schema.submissions.requestId, requestId),
      )
    : eq(schema.submissions.reviewStatus, "pending");

  const rows = await db
    .select({
      submission: schema.submissions,
      requestTitle: schema.requests.title,
      audienceLabel: schema.requests.audienceLabel,
      teacherName: schema.teachers.name,
      studentName: schema.students.name,
      rollNo: schema.students.rollNo,
      fieldLabel: schema.fieldDefs.labelEn,
    })
    .from(schema.submissions)
    .innerJoin(schema.requests, eq(schema.requests.id, schema.submissions.requestId))
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .innerJoin(schema.students, eq(schema.students.id, schema.submissions.studentId))
    .innerJoin(schema.fieldDefs, eq(schema.fieldDefs.key, schema.submissions.fieldKey))
    .where(where)
    .orderBy(
      asc(schema.requests.audienceLabel),
      asc(schema.students.rollNo),
      desc(schema.submissions.submittedAt),
    );

  if (rows.length === 0) return [];

  // Every submission for these students, not only the pending ones. See
  // newestByKey — reading pending rows alone made a retracted correction look
  // live, because the confirmation that retracts it is written as 'auto'.
  const times = await db
    .select({
      requestId: schema.submissions.requestId,
      studentId: schema.submissions.studentId,
      fieldKey: schema.submissions.fieldKey,
      submittedAt: schema.submissions.submittedAt,
    })
    .from(schema.submissions)
    .where(
      inArray(schema.submissions.studentId, [
        ...new Set(rows.map((row) => row.submission.studentId)),
      ]),
    );

  const newest = newestByKey(times);

  const alsoOn = await countSharedPhones(rows.map((row) => row.submission));

  return rows.map((row) => ({
    id: row.submission.id,
    requestId: row.submission.requestId,
    requestTitle: row.requestTitle,
    audienceLabel: row.audienceLabel,
    teacherName: row.teacherName,
    studentId: row.submission.studentId,
    studentName: row.studentName,
    rollNo: row.rollNo,
    fieldKey: row.submission.fieldKey,
    fieldLabel: row.fieldLabel,
    action: row.submission.action,
    oldValue: row.submission.oldValue,
    newValue: row.submission.newValue,
    submittedAt: row.submission.submittedAt,
    superseded: isSuperseded(row.submission, newest),
    alsoOn: alsoOn.get(row.submission.id) ?? 0,
  }));
}

const groupKey = (s: { requestId: string; studentId: string; fieldKey: string }) =>
  `${s.requestId}|${s.studentId}|${s.fieldKey}`;

type Timed = {
  requestId: string;
  studentId: string;
  fieldKey: string;
  submittedAt: Date;
};

/**
 * The newest submission time per request, student and field.
 *
 * Feed this EVERY submission for the students in question, never just the
 * pending ones. A confirmation is stored with review_status 'auto' (see
 * `confirmation` above), so a teacher who corrects a number, sends it, then
 * types the original back leaves two rows: a pending 'changed' and a newer
 * 'auto' that cancels it. Computed over pending rows alone the correction is
 * still the newest thing anyone can see, so it shows un-superseded, ticked by
 * default, and approving it writes back a value she already took back.
 */
function newestByKey(rows: Timed[]): Map<string, Date> {
  const newest = new Map<string, Date>();
  for (const row of rows) {
    const key = groupKey(row);
    const seen = newest.get(key);
    if (!seen || row.submittedAt > seen) newest.set(key, row.submittedAt);
  }
  return newest;
}

/** Strictly newer, so a tie is never treated as having been replaced. */
function isSuperseded(row: Timed, newest: Map<string, Date>): boolean {
  const latest = newest.get(groupKey(row));
  return latest ? row.submittedAt.getTime() < latest.getTime() : false;
}

/**
 * For each proposed phone number, how many other active students already have
 * it. Context for the office; never a validation rule.
 */
async function countSharedPhones(
  submissions: (typeof schema.submissions.$inferSelect)[],
): Promise<Map<string, number>> {
  const wanted = submissions.filter(
    (row) =>
      row.newValue &&
      (row.fieldKey === "phone" || row.fieldKey === "alt_phone"),
  );
  if (wanted.length === 0) return new Map();

  const numbers = [...new Set(wanted.map((row) => row.newValue!))];

  const holders = await db
    .select({
      studentId: schema.students.id,
      phone: schema.students.phone,
      altPhone: schema.students.altPhone,
    })
    .from(schema.students)
    .where(
      and(
        eq(schema.students.status, "active"),
        or(
          inArray(schema.students.phone, numbers),
          inArray(schema.students.altPhone, numbers),
        ),
      ),
    );

  const byNumber = new Map<string, Set<string>>();
  for (const holder of holders) {
    for (const value of [holder.phone, holder.altPhone]) {
      if (!value || !numbers.includes(value)) continue;
      const set = byNumber.get(value) ?? new Set<string>();
      set.add(holder.studentId);
      byNumber.set(value, set);
    }
  }

  return new Map(
    wanted.map((row) => {
      const others = new Set(byNumber.get(row.newValue!) ?? []);
      others.delete(row.studentId); // the student this correction is about
      return [row.id, others.size];
    }),
  );
}

export type Decision = "approved" | "rejected";

export type DecisionResult = {
  /**
   * How many submissions this call actually decided. Zero on a re-click, and
   * short of what was ticked when some of it had already been replaced.
   */
  applied: number;
  studentsTouched: number;
  /** Rows resolved as replaced: those ticked but stale, plus older pending ones. */
  superseded: number;
};

/**
 * Approve or reject a batch, atomically.
 *
 * The whole thing is one transaction and the UPDATE guards on
 * review_status = 'pending'. That guard is what makes a double approval a
 * no-op — two office staff clicking at once, or one impatient double-click,
 * must not write the change twice. Do not remove it for readability.
 *
 * Order inside the transaction (plan section 6):
 *   1. claim the pending rows, guarded, and see which we actually got
 *   2. drop any claimed row a later submission has already replaced
 *   3. one change_log row per claimed submission — the audit trail
 *   4. write master data: students for fields with a target column,
 *      student_records for period-scoped ones
 */
export async function decideSubmissions(
  ids: string[],
  decision: Decision,
  decidedBy: string,
  note?: string,
): Promise<DecisionResult> {
  if (ids.length === 0) {
    return { applied: 0, studentsTouched: 0, superseded: 0 };
  }

  const fields = await db.select().from(schema.fieldDefs);
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));

  return withTransaction(async (tx) => {
    // 1. Claim. Anything already decided is silently skipped by the guard.
    const claimed = await tx
      .update(schema.submissions)
      .set({ reviewStatus: decision })
      .where(
        and(
          inArray(schema.submissions.id, ids),
          eq(schema.submissions.reviewStatus, "pending"),
        ),
      )
      .returning();

    if (claimed.length === 0) {
      return { applied: 0, studentsTouched: 0, superseded: 0 };
    }

    // 2. Drop anything a later submission has already replaced.
    //
    //    The queue hides superseded rows and unticks them, but a hidden
    //    checkbox is not a guard — the ids arrive from a browser, and the row
    //    may have been replaced between the page rendering and the tap. A stale
    //    row must never reach master and must never supersede the row that
    //    replaced it, so it is turned into a rejection here and dropped from
    //    everything downstream.
    const times = await tx
      .select({
        requestId: schema.submissions.requestId,
        studentId: schema.submissions.studentId,
        fieldKey: schema.submissions.fieldKey,
        submittedAt: schema.submissions.submittedAt,
      })
      .from(schema.submissions)
      .where(
        inArray(schema.submissions.studentId, [
          ...new Set(claimed.map((row) => row.studentId)),
        ]),
      );

    const newest = newestByKey(times);
    const staleIds = new Set(
      claimed.filter((row) => isSuperseded(row, newest)).map((row) => row.id),
    );
    const effective = claimed.filter((row) => !staleIds.has(row.id));

    if (staleIds.size > 0) {
      await tx
        .update(schema.submissions)
        .set({ reviewStatus: "rejected" })
        .where(inArray(schema.submissions.id, [...staleIds]));
    }

    // 3. Audit trail, one row per claimed submission, before anything moves.
    await tx.insert(schema.changeLog).values(
      claimed.map((row) => {
        const stale = staleIds.has(row.id);
        return {
          submissionId: row.id,
          studentId: row.studentId,
          fieldKey: row.fieldKey,
          fromValue: row.oldValue,
          toValue: !stale && decision === "approved" ? row.newValue : null,
          decision: stale ? ("rejected" as const) : decision,
          decidedBy,
          note: stale
            ? "Superseded by a later submission for the same field"
            : (note ?? null),
        };
      }),
    );

    // Older pending rows for the same student and field are now moot. Resolve
    // them here rather than leaving them to rot in the queue. Only `effective`
    // rows are passed: this rejects every other pending row sharing a key, so
    // handing it a stale row would reject the very submission that replaced it.
    const superseded = await supersede(tx, effective, decidedBy);
    const resolved = superseded.length + staleIds.size;

    if (decision === "rejected") {
      return {
        applied: effective.length,
        studentsTouched: 0,
        superseded: resolved,
      };
    }

    // 4. Master data. not_present carries no value to write — it is a flag for
    //    the office, not a field update. See the note in /review.
    const applicable = effective.filter((row) => row.action === "changed");
    const touched = new Set<string>();
    /**
     * Every approved correction claims its field for `teacher`, permanently.
     *
     * Written INSIDE this transaction on purpose. If the stamp were a separate
     * step that could fail, an approved correction would sit in master looking
     * settled while still carrying the old source — and the next PSP import
     * would quietly overwrite it. That is the single failure this whole
     * precedence layer exists to prevent, so it is not allowed to be a separate
     * step. See lib/precedence.ts.
     */
    const claims: OriginWrite[] = [];

    const periods = await loadPeriods(tx, applicable);

    for (const row of applicable) {
      const field = fieldByKey.get(row.fieldKey);
      if (!field) continue;

      if (field.targetColumn) {
        const column = STUDENT_COLUMN_BY_DB_NAME.get(field.targetColumn);
        if (!column) continue; // registry points at a column that no longer exists
        await tx
          .update(schema.students)
          .set({ [column]: row.newValue, updatedAt: new Date() })
          .where(eq(schema.students.id, row.studentId));
        claims.push(teacherOrigin(row.studentId, field.targetColumn));
      } else {
        const period = periods.get(row.requestId);
        if (!period) continue; // guarded at creation; belt and braces
        await tx
          .insert(schema.studentRecords)
          .values({
            studentId: row.studentId,
            fieldKey: row.fieldKey,
            period,
            value: row.newValue,
            requestId: row.requestId,
          })
          .onConflictDoUpdate({
            target: [
              schema.studentRecords.studentId,
              schema.studentRecords.fieldKey,
              schema.studentRecords.period,
            ],
            set: { value: row.newValue, requestId: row.requestId },
          });
      }
      touched.add(row.studentId);
    }

    if (claims.length > 0) {
      const now = new Date();
      await tx
        .insert(schema.valueSources)
        .values(claims.map((claim) => ({ ...claim, sourceUpdatedAt: now })))
        .onConflictDoUpdate({
          target: [schema.valueSources.studentId, schema.valueSources.fieldKey],
          set: { sourceKey: sql`excluded."source_key"`, sourceUpdatedAt: now },
        });
    }

    return {
      applied: effective.length,
      studentsTouched: touched.size,
      superseded: resolved,
    };
  });
}

type Tx = Parameters<Parameters<typeof withTransaction>[0]>[0];
type Claimed = typeof schema.submissions.$inferSelect;

/**
 * Mark still-pending rows for the same student and field as rejected, so an
 * older correction cannot be approved on top of a newer one later.
 */
async function supersede(tx: Tx, claimed: Claimed[], decidedBy: string) {
  if (claimed.length === 0) return [];

  const older = await tx
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.reviewStatus, "pending"),
        inArray(
          schema.submissions.studentId,
          claimed.map((row) => row.studentId),
        ),
      ),
    );

  const keys = new Set(claimed.map(groupKey));
  const stale = older.filter((row) => keys.has(groupKey(row)));
  if (stale.length === 0) return [];

  await tx
    .update(schema.submissions)
    .set({ reviewStatus: "rejected" })
    .where(
      inArray(
        schema.submissions.id,
        stale.map((row) => row.id),
      ),
    );

  await tx.insert(schema.changeLog).values(
    stale.map((row) => ({
      submissionId: row.id,
      studentId: row.studentId,
      fieldKey: row.fieldKey,
      fromValue: row.oldValue,
      toValue: null,
      decision: "rejected" as const,
      decidedBy,
      note: "Superseded by a later submission for the same field",
    })),
  );

  return stale;
}

async function loadPeriods(tx: Tx, rows: Claimed[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.requestId))];
  if (ids.length === 0) return new Map();

  const found = await tx
    .select({ id: schema.requests.id, period: schema.requests.period })
    .from(schema.requests)
    .where(inArray(schema.requests.id, ids));

  return new Map(
    found
      .filter((row): row is { id: string; period: string } => row.period !== null)
      .map((row) => [row.id, row.period]),
  );
}

