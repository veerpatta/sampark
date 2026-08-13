import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema, withTransaction } from "./db";
import { isMasterField, validateField } from "./fields";
import { photoBelongsTo } from "./photos";
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
 *
 * TWO DESTINATIONS, AND ONLY ONE OF THEM IS REVIEWED.
 *
 * A field with a target_column is master data and goes through the queue exactly
 * as it always has — Rule 3 is a rule about the `students` table, and it is
 * untouched. A field WITHOUT one (a subject mark, a one-off question) is written
 * straight to student_records here, at submit, and never appears in /review.
 *
 * That is not a hole in Rule 3, because every reason the rule exists is a
 * property of master data and not of this table:
 *
 *   - nothing else writes student_records, so there is no import to lose an
 *     argument to and no precedence to get wrong (lib/precedence.ts stamps
 *     value_sources, which a mark never gets);
 *   - there is no prior value to destroy — a mark is collected, not confirmed;
 *   - the row is keyed by (student, field, period), so a correction overwrites
 *     the one value it is about and nothing else.
 *
 * What it buys is the whole point: a marks round is forty-six children times
 * four subjects, and asking the office to approve a hundred and eighty rows it
 * has no way to check is asking it to click Approve without reading. A review
 * nobody can actually perform is worse than no review, because the record then
 * claims someone checked.
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

  /*
   * A period-scoped request with no period should be impossible: resolvePeriod
   * (lib/requests.ts) throws at creation rather than let one exist. Say so out
   * loud if one turns up anyway.
   *
   * statusFor keeps her answer as 'pending' in that case, so it lands in
   * /review where a human will find it instead of being written nowhere. This
   * is the failure the field registry's own note calls out as the worst kind —
   * a teacher gets a 201 and the work is gone, with nothing anywhere to show it
   * ever arrived.
   */
  if (!request.period && request.fields.some((field) => !isMasterField(field))) {
    console.error(
      `Request ${request.requestId} collects a period-scoped field but has no period; ` +
        `those answers will queue for review instead of being recorded.`,
    );
  }

  type Row = typeof schema.submissions.$inferInsert;
  const rows: Row[] = [];

  for (const answer of answers) {
    const student = roster.get(answer.studentId);
    if (!student) continue;

    for (const field of request.fields) {
      const frozen = normalise(field, student.values[field.key] ?? null);

      if (answer.notPresent) {
        // 'pending' EVEN FOR A MARK, which is the one place the auto-apply rule
        // above does not reach. It carries no value to write, so there is
        // nothing to apply — and "this child is not in my class" is precisely
        // the kind of thing the office has to see, whatever field raised it. A
        // roster is wrong and someone has to fix it.
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
      //
      // UNLESS WE SHOWED HER NOTHING. "Confirmed, old = new = null" about a
      // field that was empty on her screen and empty in master asserts that she
      // checked something nobody has looked at — and once it is in this table
      // the office cannot tell it from a real confirmation. It is also what let
      // a half-filled card count as fully answered on the status board. Say
      // nothing instead; silence is the honest record of a box left empty.
      //
      // This is the server's own copy of requiredKeys() in the teacher types:
      // it skips exactly the fields she had to answer and did not.
      if (supplied === undefined) {
        if (frozen === null) continue;
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

      /*
       * THE ONE FIELD-TYPE SPECIAL CASE IN THIS FUNCTION, AND IT IS LOAD-BEARING.
       *
       * A photo's value is the pathname of a blob, and validateField has
       * already checked it has the shape this app mints. What it cannot check
       * is WHOSE it is — it sees a field definition and a string, not a row.
       * Without this, a teacher holding a live token can put the pathname of
       * one child's photograph on another child on her roster, and the office
       * approves a face that belongs to somebody else.
       *
       * It is a validation failure rather than a silent skip because nothing a
       * real phone does produces one: her own upload returns the pathname the
       * server just minted for that student.
       */
      if (
        field.inputType === "photo" &&
        checked.value !== null &&
        !photoBelongsTo(checked.value, student.studentId)
      ) {
        failures.push({
          studentId: student.studentId,
          fieldKey: field.key,
          error: "That photo was not taken for this student.",
          errorHi: "यह फ़ोटो इस बच्चे की नहीं है — दोबारा लें।",
        });
        continue;
      }

      // Blank means "no change", never "erase" — the same rule the importer
      // follows. A teacher has no way to say "this value should be empty", and
      // silently emptying a parent's phone number because a field was cleared
      // by accident is not a mistake we can detect later.
      if (checked.value === null) {
        // Same exception as above: blank over nothing is not a confirmation of
        // anything. The rule below it — blank never erases a value we DO hold —
        // is untouched.
        if (frozen === null) continue;
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
        reviewStatus: statusFor(field, request.period),
        clientHash,
      });
    }
  }

  if (failures.length > 0) throw new SubmissionValidationError(failures);
  // Reachable a second way since the guards above: a payload naming a student
  // whose every field was empty on her screen and left empty by her. Nothing to
  // record, and nothing lost — the teacher surface will not produce one, and a
  // stale tab that does simply writes nothing and stays uncounted.
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
  /*
   * The values that go straight into the record, keyed so a repeat collapses.
   *
   * DEDUPED BECAUSE POSTGRES REFUSES an ON CONFLICT DO UPDATE that would touch
   * the same row twice in one statement, and the upsert below is one statement
   * over many rows. parseAnswers (api/r/[token]/route.ts) does not dedupe and
   * the roster lookup succeeds on both entries, so a stale tab naming a student
   * twice reaches here. Last one wins. Exactly the guard recordOrigins already
   * carries for value_sources — see the note at lib/precedence.ts:182.
   *
   * Only 'applied' rows, which by construction means action 'changed' on a
   * non-master field. A CONFIRMED mark is deliberately absent: the value it
   * confirms is already in student_records (it is what loadPriorRecords
   * prefilled), so the write would be a no-op on `value` while re-stamping
   * `request_id` — quietly re-attributing a mark to whoever last confirmed it
   * rather than to whoever entered it. That column is the only attribution the
   * marks export has.
   */
  const records = new Map<string, typeof schema.studentRecords.$inferInsert>();
  for (const row of rows) {
    if (row.reviewStatus !== "applied") continue;
    records.set(`${row.studentId}|${row.fieldKey}`, {
      studentId: row.studentId,
      fieldKey: row.fieldKey,
      period: request.period!,
      value: row.newValue,
      requestId: request.requestId,
    });
  }

  // A round that collects nothing but master data pays for none of the above.
  if (records.size === 0) {
    for (let i = 0; i < rows.length; i += 200) {
      await db
        .insert(schema.submissions)
        .values(rows.slice(i, i + 200))
        .onConflictDoNothing();
    }
    return tally(rows);
  }

  /*
   * ONE BATCH, so a mark and the row that records it land together.
   *
   * db.batch sends the lot as a single atomic request over the HTTP driver.
   * NOT withTransaction: that opens a WebSocket pool per call, and its own doc
   * comment (lib/db.ts) says it exists for the approval path, which has to READ
   * a result partway through and branch on it. Nothing here branches — every
   * value is computed before the first statement — and this is the one path in
   * the app that runs on a village phone on a bad signal, so it does not get to
   * pay for a capability it never uses. Same shape as the importer's writes:
   * see applyPreview in lib/students-import.ts.
   */
  const statements = [
    ...chunks(rows, 200).map((chunk) =>
      db.insert(schema.submissions).values(chunk).onConflictDoNothing(),
    ),
    ...chunks([...records.values()], 200).map((chunk) =>
      db
        .insert(schema.studentRecords)
        .values(chunk)
        /*
         * The same upsert the approval path uses, for the same reason: a
         * teacher who re-opens her link and corrects a mark before the round
         * closes must overwrite the one she typed first, not add a second. What
         * she originally sent is never lost — it is a submissions row, and that
         * table is append-only.
         *
         * `excluded.*` rather than the literal decideSubmissions uses, because
         * this statement carries many rows and a literal would write one row's
         * value over all of them.
         *
         * LAST ARRIVAL WINS, which is weaker than the review path's ordering.
         * newestByKey/isSuperseded stop an older answer landing on top of a
         * newer one; here two batches flushed out of order by a phone that was
         * offline would apply the older mark last. Accepted rather than fixed
         * with a version counter: she is looking at the number she just typed,
         * and re-sending it is one tap.
         */
        .onConflictDoUpdate({
          target: [
            schema.studentRecords.studentId,
            schema.studentRecords.fieldKey,
            schema.studentRecords.period,
          ],
          set: {
            value: sql`excluded."value"`,
            requestId: sql`excluded."request_id"`,
          },
        }),
    ),
  ];

  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);

  return tally(rows);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function tally(rows: (typeof schema.submissions.$inferInsert)[]): RecordResult {
  return {
    recorded: rows.length,
    changed: rows.filter((row) => row.action === "changed").length,
    confirmed: rows.filter((row) => row.action === "confirmed").length,
    notPresent: rows.filter((row) => row.action === "not_present").length,
  };
}

/**
 * Where a corrected value goes: the review queue, or straight into the record.
 *
 * 'applied' IS A DISTINCT STATUS, NOT A REUSE OF 'auto'. They are different
 * facts about a row and the difference is the whole audit trail for a mark:
 * 'auto' means she confirmed what we showed her and there was nothing to
 * decide, 'applied' means this went into the record without anyone deciding.
 * Fold them together and nothing downstream can tell a mark that landed from a
 * phone number that was already right. The column is plain text with no enum
 * and no check constraint, so a third value costs nothing.
 *
 * The `period` guard is belt and braces. resolvePeriod (lib/requests.ts) makes
 * a period-scoped request without one impossible at creation, but if one ever
 * existed the record write would be skipped — and a row claiming 'applied' when
 * nothing was applied is the one lie this status must not tell. It queues
 * instead, where a human will notice it.
 */
function statusFor(field: FieldDef, period: string | null): "pending" | "applied" {
  return isMasterField(field) || !period ? "pending" : "applied";
}

/**
 * A confirmation that matches the snapshot is not a reviewable change.
 *
 * It lands with review_status 'auto' so it never appears in the queue — the
 * office should only ever be asked to look at things that actually differ.
 * The row is still written, because "she checked it and it was right" is the
 * single most useful fact this system collects.
 *
 * 'auto' FOR A MARK TOO, never 'applied'. A confirmed mark is one she was shown
 * and left alone, so the value is already in student_records — writing it again
 * would change nothing except request_id, and that column is what the marks
 * export uses to say who entered a number. See the note on `records` above.
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
  /**
   * The field's registry input type, carried so the queue can RENDER the value
   * rather than print it.
   *
   * A photo's value is a blob pathname, and a pathname in a monospace cell is
   * unreadable — which would mean approving a photograph of a child into the
   * master record without anyone having looked at it. Carried as the type
   * rather than compared against the key 'photo', so a second photo field added
   * as a row in field_defs renders correctly with no deploy (rule 11).
   */
  inputType: string;
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
      inputType: schema.fieldDefs.inputType,
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
    inputType: row.inputType,
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
 *
 * THE student_records BRANCH IN STEP 4 IS NOW A DRAIN, NOT A PATH. Since marks
 * apply at submit time (see recordSubmissions), nothing new arrives here with a
 * target column of NULL. It stays because rows that were already pending when
 * that changed are still in the queue and still have to approve correctly, and
 * because it costs nothing to leave. Do not build anything new on it.
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

