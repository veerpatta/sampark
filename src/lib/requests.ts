import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { generateToken } from "./auth/token";
import {
  compareStudentNames,
  isClassLabel,
  normaliseClassLabel,
  unknownClassLabelMessage,
} from "./classes";
import { listClassRoster } from "./students";
import { buildSnapshots, recordKey, type RosterSnapshot } from "./snapshots";
import type { ScopeKind } from "./ownership";
import { hasPhone, isCompletePhone, normalisePhone, samePhone } from "./phone";
import type { FieldDef, Student } from "../../drizzle/schema";

/**
 * Request creation and the roster snapshot.
 *
 * The snapshot is the whole point of this module. `request_students.snapshot`
 * freezes what the teacher was actually shown at the moment the link was sent,
 * and it is NEVER recomputed. If a phone number in master changes between
 * sending the link and reviewing the reply, the review screen must still say
 * "old value" = the number on the teacher's screen. Recomputing it would make
 * every review a guess. See plan section 4 and standing rule 6.
 */

/**
 * The snapshot type and its builder live in lib/snapshots.ts — pure, so a
 * bulk send can build nineteen classes' worth from one audience read. Re-exported
 * because callers have always imported it from here.
 */
export type { RosterSnapshot };

export type CreateRequestInput = {
  title: string;
  classLabel: string;
  teacherId: string;
  fieldKeys: string[];
  period?: string | null;
  dueDate: string;
  createdBy: string;
  /**
   * A number for THIS request only, when the teacher's saved one is wrong or
   * missing. Stored as null when it matches what we already hold, so that the
   * column means "an override was made" and not merely "a form was submitted".
   */
  contactPhone?: string | null;
};

/**
 * Everything one request needs that a fan-out has already loaded.
 *
 * A bulk send resolves the audience, the field registry and the prior
 * period-scoped records ONCE, then creates nineteen requests from them. Letting
 * each request re-read those would turn one query into nineteen, three times
 * over, on a path that already makes a hundred round trips.
 */
export type RequestDeps = {
  roster: Student[];
  fields: FieldDef[];
  priorRecords: Map<string, string | null>;
  token: string;
  /** Pre-generated so an ad-hoc field can derive its period from it. */
  requestId: string;
};

export type ScopedRequestInput = {
  title: string;
  /** NULL for a house or route link, whose roster spans classes. */
  classLabel: string | null;
  audienceKind: ScopeKind;
  audienceLabel: string;
  batchId?: string | null;
  teacherId: string;
  fieldKeys: string[];
  period: string | null;
  dueDate: string;
  createdBy: string;
  contactPhone?: string | null;
};

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

/**
 * Create one request for one class. The single-request front door.
 *
 * Loads everything itself and hands off to createOneRequest, which is what a
 * bulk send drives directly with a roster and a field list it has already read.
 */
export async function createRequest(input: CreateRequestInput): Promise<{
  id: string;
  token: string;
  rosterSize: number;
}> {
  const classLabel = normaliseClassLabel(input.classLabel);
  if (!classLabel) throw new RequestValidationError("Pick a class.");
  // A label off the list would match no student and freeze an empty roster
  // without raising anything. Refuse before a token is even generated.
  if (!isClassLabel(classLabel)) {
    throw new RequestValidationError(unknownClassLabelMessage(classLabel));
  }

  // Minted before the period is resolved, because an ad-hoc question files its
  // answers under the request that asked it.
  const requestId = randomUUID();
  const fieldKeys = normaliseFieldKeys(input.fieldKeys);
  const fields = await resolveFields(fieldKeys);
  const period = resolvePeriod(fields, input.period, requestId);

  const roster = await listClassRoster(classLabel);
  if (roster.length === 0) {
    throw new RequestValidationError(
      `No active students in class ${classLabel}. Import the class first.`,
    );
  }

  const [token] = await uniqueTokens(1);

  return createOneRequest(
    {
      title: input.title,
      classLabel,
      audienceKind: "class",
      audienceLabel: classLabel,
      teacherId: input.teacherId,
      fieldKeys,
      period,
      dueDate: input.dueDate,
      createdBy: input.createdBy,
      contactPhone: input.contactPhone,
    },
    {
      roster,
      fields,
      priorRecords: await loadPriorRecords(roster, fields, period),
      token: token!,
      requestId,
    },
  );
}

/**
 * Create one request from work already done.
 *
 * The roster it freezes is `deps.roster` exactly — a house-wide audience is cut
 * into per-teacher rosters by the caller, so this never re-queries and never
 * second-guesses who is in scope.
 */
export async function createOneRequest(
  input: ScopedRequestInput,
  deps: RequestDeps,
): Promise<{ id: string; token: string; rosterSize: number }> {
  const title = input.title.trim();
  if (!title) throw new RequestValidationError("Give the request a title.");
  if (input.fieldKeys.length === 0) {
    throw new RequestValidationError("Pick at least one field to ask about.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    throw new RequestValidationError("Pick a due date.");
  }
  if (deps.roster.length === 0) {
    throw new RequestValidationError(
      `No active students in ${input.audienceLabel}.`,
    );
  }

  const { teacher, contactPhone } = await resolveRecipient(
    input.teacherId,
    input.contactPhone,
  );

  const snapshots = buildSnapshots(deps.roster, deps.fields, deps.priorRecords);

  const [request] = await db
    .insert(schema.requests)
    .values({
      id: deps.requestId,
      token: deps.token,
      title,
      classLabel: input.classLabel,
      audienceKind: input.audienceKind,
      audienceLabel: input.audienceLabel,
      batchId: input.batchId ?? null,
      teacherId: teacher.id,
      fieldKeys: input.fieldKeys,
      period: input.period,
      dueDate: input.dueDate,
      contactPhone,
      createdBy: input.createdBy,
    })
    .returning({ id: schema.requests.id });

  if (!request) throw new Error("Request insert returned nothing.");

  // The roster is written immediately after, in chunks. A request whose roster
  // failed to write would open to an empty list on the teacher's phone, so if
  // this throws we delete the request rather than leave that behind.
  try {
    const rows = deps.roster.map((student) => ({
      requestId: request.id,
      studentId: student.id,
      rollNo: student.rollNo,
      snapshot: snapshots.get(student.id)!,
    }));

    for (let i = 0; i < rows.length; i += 100) {
      await db.insert(schema.requestStudents).values(rows.slice(i, i + 100));
    }
  } catch (error) {
    await db.delete(schema.requests).where(eq(schema.requests.id, request.id));
    throw error;
  }

  return { id: request.id, token: deps.token, rosterSize: deps.roster.length };
}

/* --------------------------------------------------------- shared validation */

export function normaliseFieldKeys(keys: string[]): string[] {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}

/** The teacher this link is for, and the number it will actually be sent to. */
async function resolveRecipient(
  teacherId: string,
  contactPhoneInput: string | null | undefined,
) {
  const [teacher] = await db
    .select()
    .from(schema.teachers)
    .where(eq(schema.teachers.id, teacherId))
    .limit(1);

  if (!teacher) throw new RequestValidationError("That teacher does not exist.");
  if (!teacher.active) {
    throw new RequestValidationError(`${teacher.name} is marked inactive.`);
  }

  // Whatever number this link is going to has to exist before we mint a token
  // for it. A request nobody can be sent is a roster frozen for nothing.
  const typed = normalisePhone(contactPhoneInput);
  if (typed && !isCompletePhone(typed)) {
    throw new RequestValidationError(
      "A mobile number is 10 digits. Leave it blank to use her saved one.",
    );
  }
  if (!typed && !hasPhone(teacher.phone)) {
    throw new RequestValidationError(
      `No number is saved for ${teacher.name}. Type one for this request.`,
    );
  }

  // Null means "use her saved number". Only a genuine override is stored, so
  // the column reads as a decision rather than as form noise.
  return {
    teacher,
    contactPhone: typed && !samePhone(typed, teacher.phone) ? typed : null,
  };
}

/** The field registry rows for these keys, refusing unknown or switched-off ones. */
export async function resolveFields(fieldKeys: string[]): Promise<FieldDef[]> {
  if (fieldKeys.length === 0) {
    throw new RequestValidationError("Pick at least one field to ask about.");
  }

  const fields = await db
    .select()
    .from(schema.fieldDefs)
    .where(inArray(schema.fieldDefs.key, fieldKeys));

  const missing = fieldKeys.filter(
    (key) => !fields.some((field) => field.key === key),
  );
  if (missing.length > 0) {
    throw new RequestValidationError(`Unknown field: ${missing.join(", ")}`);
  }

  const inactive = fields.filter((field) => !field.active);
  if (inactive.length > 0) {
    throw new RequestValidationError(
      `${inactive.map((field) => field.labelEn).join(", ")} is switched off in the field registry.`,
    );
  }

  return fields;
}

/** A one-off question added while building a request. See ADHOC_KIND below. */
export const ADHOC_KIND = "adhoc";

export const isAdhocField = (field: FieldDef) =>
  field.targetColumn === null && field.recordKind === ADHOC_KIND;

/**
 * Where a period-scoped answer is filed.
 *
 * A field with no target column lands in student_records, which is keyed by
 * period — that is how marks work, and "2026-27/FA1" is a real thing the office
 * knows. But an ad-hoc question like "T-shirt size" has no period, and asking
 * her to invent one is a trap: whatever she types becomes the key those answers
 * live under forever.
 *
 * So an ad-hoc question files itself under the ASK that raised it — the request
 * for a single send, the batch for a bulk one, so nineteen classes answering one
 * question land in one period rather than nineteen. Unique by construction,
 * nothing to have to think about, and student_records.request_id already exists
 * so the student page can render "T-shirt size: M — asked in Uniform sizes,
 * 12 Aug" without parsing anything.
 *
 * `scopeId` is absent when previewing, where the value is never written and only
 * the compatibility check below matters.
 */
export function resolvePeriod(
  fields: FieldDef[],
  input: string | null | undefined,
  scopeId?: string,
): string | null {
  const period = input?.trim() || null;
  const periodScoped = fields.filter((field) => field.targetColumn === null);
  const adhoc = periodScoped.filter(isAdhocField);

  // One `period` column cannot be both "2026-27/FA1" and this request at once,
  // and silently filing marks under a request id would hide them from every
  // later period lookup.
  if (adhoc.length > 0 && adhoc.length < periodScoped.length) {
    throw new RequestValidationError(
      "Marks and a one-off question cannot go in the same request — marks are stored against a period and a question against the request. Send them separately.",
    );
  }

  if (adhoc.length > 0) {
    return scopeId ? `ask/${scopeId}` : null;
  }

  if (periodScoped.length > 0 && !period) {
    throw new RequestValidationError(
      "Collecting marks needs a period, for example 2026-27/FA1.",
    );
  }
  return period;
}

/**
 * What the school already holds for the period-scoped fields in this request.
 *
 * Re-sending an FA request for a period already partly filled should show the
 * teacher what is there rather than a blank column. Read once per send, for the
 * whole audience, and shared across every request the fan-out creates.
 */
export async function loadPriorRecords(
  roster: Student[],
  fields: FieldDef[],
  period: string | null,
): Promise<Map<string, string | null>> {
  const recordFields = fields.filter((field) => field.targetColumn === null);
  const priorRecords = new Map<string, string | null>();

  if (recordFields.length === 0 || !period || roster.length === 0) {
    return priorRecords;
  }

  const rows = await db
    .select()
    .from(schema.studentRecords)
    .where(
      and(
        eq(schema.studentRecords.period, period),
        inArray(
          schema.studentRecords.fieldKey,
          recordFields.map((field) => field.key),
        ),
        inArray(
          schema.studentRecords.studentId,
          roster.map((student) => student.id),
        ),
      ),
    );

  for (const row of rows) {
    priorRecords.set(recordKey(row.studentId, row.fieldKey), row.value);
  }

  return priorRecords;
}

/**
 * N tokens that no request already holds.
 *
 * 96 bits of entropy makes a collision a non-event, but a duplicate token would
 * be a silent cross-group data leak, so check rather than assume. Checked in one
 * query for the whole batch: the previous version cost a round trip per request,
 * which a nineteen-way fan-out pays nineteen times before it inserts anything.
 *
 * The unique index on requests.token remains the real guarantee — this only
 * keeps the insert from being the thing that discovers the clash.
 */
export async function uniqueTokens(count: number): Promise<string[]> {
  const chosen = new Set<string>();

  for (let attempt = 0; attempt < 5 && chosen.size < count; attempt += 1) {
    const candidates = new Set<string>();
    while (candidates.size < count - chosen.size) {
      candidates.add(generateToken());
    }

    const taken = await db
      .select({ token: schema.requests.token })
      .from(schema.requests)
      .where(inArray(schema.requests.token, [...candidates]));

    const clashes = new Set(taken.map((row) => row.token));
    for (const candidate of candidates) {
      if (!clashes.has(candidate)) chosen.add(candidate);
    }
  }

  if (chosen.size < count) {
    throw new Error("Could not generate unique tokens.");
  }
  return [...chosen];
}

/* ------------------------------------------------------------------ boards */

export type RequestBoardRow = {
  id: string;
  title: string;
  /** The group this link was for: a class, a house or a bus route. */
  audienceLabel: string;
  audienceKind: string;
  teacher: string;
  dueDate: string;
  status: string;
  /** For the one-tap reminder on the dashboard, without a second page load. */
  token: string;
  teacherPhone: string;
  rosterSize: number;
  studentsAnswered: number;
  changesPending: number;
  /** Set once the office has taken it off the boards. Null for a live row. */
  archivedAt: Date | null;
};

/**
 * Students who have answered for every field their request asked about.
 *
 * "ANSWERED" USED TO MEAN "HAS ANY SUBMISSION", AND THAT WAS THE BUG. A card
 * with one of two boxes filled writes a submission for the one box, so the
 * child counted as fully answered and a class still missing six phone numbers
 * rendered a green "46 of 46". Coverage of the whole field set is the only
 * definition that survives a partly-filled card.
 *
 * Two details that are load-bearing:
 *
 *   - not_present writes one row per field (lib/submissions.ts), so a child the
 *     teacher says is not in her class still covers everything and still
 *     counts. That is right: she answered.
 *   - the `= any(field_keys)` restriction stops a submission for a key the
 *     request no longer asks about from counting toward coverage. Nothing
 *     writes one today; a request whose field set was ever edited could.
 *
 * field_keys is text[], and array_length returns NULL rather than 0 for an
 * empty array — hence the coalesce, without which a fieldless request would
 * compare against NULL and count nobody.
 */
function coveredStudentsQuery(requestIds: string[]) {
  return db
    .select({
      requestId: schema.submissions.requestId,
      studentId: schema.submissions.studentId,
    })
    .from(schema.submissions)
    .innerJoin(
      schema.requests,
      eq(schema.requests.id, schema.submissions.requestId),
    )
    .where(
      and(
        inArray(schema.submissions.requestId, requestIds),
        sql`${schema.submissions.fieldKey} = any(${schema.requests.fieldKeys})`,
      ),
    )
    .groupBy(
      schema.submissions.requestId,
      schema.submissions.studentId,
      schema.requests.fieldKeys,
    )
    .having(
      sql`count(distinct ${schema.submissions.fieldKey}) >= coalesce(array_length(${schema.requests.fieldKeys}, 1), 0)`,
    );
}

/**
 * The status board. Reads the request_progress view from plan section 4.3.
 *
 * Archived requests are absent unless asked for. Hiding them HERE rather than in
 * each reader is the same reasoning as coveredStudentsQuery: the dashboard, the
 * requests table and the overdue list all ask this one function what exists, and
 * a filter any of them could forget is a filter one of them eventually will.
 */
export async function listRequests(
  options: { includeArchived?: boolean } = {},
): Promise<RequestBoardRow[]> {
  const rows = await db
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      audienceLabel: schema.requests.audienceLabel,
      audienceKind: schema.requests.audienceKind,
      teacher: schema.teachers.name,
      dueDate: schema.requests.dueDate,
      status: schema.requests.status,
      token: schema.requests.token,
      // contact_phone when the office overrode it for this request, her saved
      // number otherwise. One extra projection on a join that already exists.
      teacherPhone: sql<string>`coalesce(nullif(${schema.requests.contactPhone}, ''), ${schema.teachers.phone})`,
      archivedAt: schema.requests.archivedAt,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .where(
      options.includeArchived
        ? undefined
        : isNull(schema.requests.archivedAt),
    )
    .orderBy(desc(schema.requests.createdAt));

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  // One row per student who has answered for EVERY field their request asked
  // about. See coveredStudentsQuery for why "answered" cannot mean "has any
  // submission".
  const covered = coveredStudentsQuery(ids).as("covered");

  // The counts behind "8 of 11 classes submitted". Three small aggregates beat
  // one clever join here — this board is read far more often than it is slow.
  const [rosterCounts, answered, pending] = await Promise.all([
    db
      .select({
        requestId: schema.requestStudents.requestId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.requestStudents)
      .where(inArray(schema.requestStudents.requestId, ids))
      .groupBy(schema.requestStudents.requestId),
    db
      .select({ requestId: covered.requestId, n: sql<number>`count(*)::int` })
      .from(covered)
      .groupBy(covered.requestId),
    db
      .select({
        requestId: schema.submissions.requestId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.submissions)
      .where(
        and(
          inArray(schema.submissions.requestId, ids),
          eq(schema.submissions.reviewStatus, "pending"),
        ),
      )
      .groupBy(schema.submissions.requestId),
  ]);

  const toMap = (list: { requestId: string; n: number }[]) =>
    new Map(list.map((row) => [row.requestId, row.n]));

  const sizes = toMap(rosterCounts);
  const answers = toMap(answered);
  const changes = toMap(pending);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    audienceLabel: row.audienceLabel,
    audienceKind: row.audienceKind,
    teacher: row.teacher,
    dueDate: row.dueDate,
    status: row.status,
    token: row.token,
    teacherPhone: row.teacherPhone,
    rosterSize: sizes.get(row.id) ?? 0,
    studentsAnswered: answers.get(row.id) ?? 0,
    changesPending: changes.get(row.id) ?? 0,
    archivedAt: row.archivedAt,
  }));
}

/**
 * Who on this roster has not answered yet.
 *
 * Feeds the reminder builder, the "still waiting" list on the request page, and
 * the warning before the office closes a request. "Answered" means answered for
 * EVERY field the request asked about — a confirmation counts, because the
 * teacher has done the work either way, but a card with one of two boxes filled
 * does not. Getting that wrong drops a child off the very list the office uses
 * to chase her. See coveredStudentsQuery.
 */
export async function listNonResponders(requestId: string): Promise<
  { studentId: string; rollNo: number | null; name: string }[]
> {
  const [roster, answered] = await Promise.all([
    db
      .select()
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, requestId)),
    coveredStudentsQuery([requestId]),
  ]);

  const done = new Set(answered.map((row) => row.studentId));

  return roster
    .filter((row) => !done.has(row.studentId))
    .map((row) => ({
      studentId: row.studentId,
      rollNo: row.rollNo,
      // The frozen snapshot, not the live master record — this list is about
      // what the teacher was sent.
      name: (row.snapshot as { name?: string }).name ?? row.studentId,
    }))
    .sort((a, b) => compareStudentNames(a.name, b.name));
}

export type CollectedRow = {
  studentId: string;
  srNo: string | null;
  name: string;
  route: string | null;
  /** Keyed by field key: what the school held when the link was sent. */
  sent: Record<string, string | null>;
  /** Keyed by field key: the newest thing the teacher said, if anything. */
  answered: Record<string, string | null>;
  /** '', 'confirmed', 'changed', 'not in class' — what she did overall. */
  outcome: string;
  reviewStatus: string;
};

/**
 * Everything one request collected, for export.
 *
 * Reads the frozen snapshot for "what we sent" and the newest submission per
 * field for "what she said". Deliberately shows both: a file that only carried
 * the new value would make it impossible to see, later, what the correction
 * actually corrected.
 */
export async function collectedFor(requestId: string): Promise<{
  request: typeof schema.requests.$inferSelect;
  teacher: typeof schema.teachers.$inferSelect;
  fields: FieldDef[];
  rows: CollectedRow[];
} | null> {
  const detail = await getRequestDetail(requestId);
  if (!detail) return null;

  const [roster, subs] = await Promise.all([
    db
      .select()
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, requestId)),
    db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.requestId, requestId))
      .orderBy(asc(schema.submissions.submittedAt)),
  ]);

  // Later submissions overwrite earlier ones for the same student and field,
  // so iterating in submitted order leaves the newest answer in the map.
  const newest = new Map<string, (typeof subs)[number]>();
  for (const row of subs) {
    newest.set(`${row.studentId}|${row.fieldKey}`, row);
  }

  const rows: CollectedRow[] = roster.map((entry) => {
    const snapshot = entry.snapshot as {
      name?: string;
      srNo?: string | null;
      route?: string | null;
      values?: Record<string, string | null>;
    };

    const sent: Record<string, string | null> = {};
    const answered: Record<string, string | null> = {};
    const actions = new Set<string>();
    const statuses = new Set<string>();

    for (const field of detail.fields) {
      sent[field.key] = snapshot.values?.[field.key] ?? null;
      const submission = newest.get(`${entry.studentId}|${field.key}`);
      answered[field.key] = submission?.newValue ?? null;
      if (submission) {
        actions.add(submission.action);
        statuses.add(submission.reviewStatus);
      }
    }

    return {
      studentId: entry.studentId,
      srNo: snapshot.srNo ?? null,
      name: snapshot.name ?? entry.studentId,
      route: snapshot.route ?? null,
      sent,
      answered,
      outcome: describeOutcome(actions),
      reviewStatus: [...statuses].sort().join(", "),
    };
  });

  rows.sort((a, b) => compareStudentNames(a.name, b.name));

  return { ...detail, rows };
}

function describeOutcome(actions: Set<string>): string {
  if (actions.size === 0) return "no answer";
  if (actions.has("not_present")) return "not in class";
  if (actions.has("changed")) return "corrected";
  return "confirmed";
}

export async function getRequestDetail(id: string) {
  const [row] = await db
    .select({
      request: schema.requests,
      teacher: schema.teachers,
    })
    .from(schema.requests)
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .where(eq(schema.requests.id, id))
    .limit(1);

  if (!row) return null;

  const [fields, roster, recorded] = await Promise.all([
    db
      .select()
      .from(schema.fieldDefs)
      .where(inArray(schema.fieldDefs.key, row.request.fieldKeys))
      .orderBy(asc(schema.fieldDefs.sortOrder)),
    db
      .select({ studentId: schema.requestStudents.studentId })
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, id)),
    // Submission ROWS, not students answered. The remove control decides between
    // deleting and archiving on whether anything was ever recorded, and a
    // student can hold submissions without being counted as covered — labelling
    // that request "delete permanently" would be a promise the foreign key is
    // about to break.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.submissions)
      .where(eq(schema.submissions.requestId, id)),
  ]);

  return {
    ...row,
    fields,
    rosterSize: roster.length,
    submissionCount: recorded[0]?.n ?? 0,
  };
}
