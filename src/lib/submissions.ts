import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db, schema, withTransaction } from "./db";
import { validateField } from "./fields";
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
  classLabel: string;
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
      classLabel: schema.requests.classLabel,
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
      asc(schema.requests.classLabel),
      asc(schema.students.rollNo),
      desc(schema.submissions.submittedAt),
    );

  const newest = new Map<string, Date>();
  for (const row of rows) {
    const key = groupKey(row.submission);
    const seen = newest.get(key);
    if (!seen || row.submission.submittedAt > seen) {
      newest.set(key, row.submission.submittedAt);
    }
  }

  const alsoOn = await countSharedPhones(rows.map((row) => row.submission));

  return rows.map((row) => ({
    id: row.submission.id,
    requestId: row.submission.requestId,
    requestTitle: row.requestTitle,
    classLabel: row.classLabel,
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
    superseded:
      row.submission.submittedAt.getTime() !==
      newest.get(groupKey(row.submission))!.getTime(),
    alsoOn: alsoOn.get(row.submission.id) ?? 0,
  }));
}

const groupKey = (s: { requestId: string; studentId: string; fieldKey: string }) =>
  `${s.requestId}|${s.studentId}|${s.fieldKey}`;

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
  /** How many submissions this call actually claimed. Zero on a re-click. */
  applied: number;
  studentsTouched: number;
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
 *   2. one change_log row per claimed submission — the audit trail
 *   3. write master data: students for fields with a target column,
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

    // 2. Audit trail, one row per claimed submission, before anything moves.
    await tx.insert(schema.changeLog).values(
      claimed.map((row) => ({
        submissionId: row.id,
        studentId: row.studentId,
        fieldKey: row.fieldKey,
        fromValue: row.oldValue,
        toValue: decision === "approved" ? row.newValue : null,
        decision,
        decidedBy,
        note: note ?? null,
      })),
    );

    // Older pending rows for the same student and field are now moot. Resolve
    // them here rather than leaving them to rot in the queue.
    const superseded = await supersede(tx, claimed, decidedBy);

    if (decision === "rejected") {
      return {
        applied: claimed.length,
        studentsTouched: 0,
        superseded: superseded.length,
      };
    }

    // 3. Master data. not_present carries no value to write — it is a flag for
    //    the office, not a field update. See the note in /review.
    const applicable = claimed.filter((row) => row.action === "changed");
    const touched = new Set<string>();

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

    return {
      applied: claimed.length,
      studentsTouched: touched.size,
      superseded: superseded.length,
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

