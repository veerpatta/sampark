import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { generateToken } from "./auth/token";
import {
  compareClassLabels,
  compareStudentNames,
  isClassLabel,
  normaliseClassLabel,
  unknownClassLabelMessage,
} from "./classes";
import { listClassRoster } from "./students";
import { buildSnapshots, recordKey, type RosterSnapshot } from "./snapshots";
import type { AudienceKind } from "./ownership";
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
  audienceKind: AudienceKind;
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
  /**
   * Her id, because the dashboard groups her rows into one reminder and a name
   * is not a key — two teachers can share one. See lib/reminders.ts.
   */
  teacherId: string;
  dueDate: string;
  status: string;
  /** For the one-tap reminder on the dashboard, without a second page load. */
  token: string;
  teacherPhone: string;
  /**
   * The per-request override, or null when this went to her saved number.
   *
   * Kept SEPARATE from the coalesced `teacherPhone` above, which cannot answer
   * "was this redirected" — an override that happens to equal her saved number
   * and no override at all look identical once coalesced. The dashboard says so
   * out loud, because a nudge going to a covering teacher's phone should not be
   * silent about it.
   */
  contactPhone: string | null;
  /** What this request asks for — names the subject in a subject link's message. */
  fieldKeys: string[];
  /** Her durable page, when she has one. The nudge prefers it. */
  teacherLinkToken: string | null;
  rosterSize: number;
  studentsAnswered: number;
  changesPending: number;
  /** Set once the office has taken it off the boards. Null for a live row. */
  archivedAt: Date | null;
  /**
   * The round this link belongs to, or null for a one-off.
   *
   * The board reads it to show a nineteen-class fan-out as ONE row instead of
   * nineteen anonymous ones. See groupBoardRows below.
   */
  batchId: string | null;
  /** What the board sorts on, and what a round takes as its own date. */
  createdAt: Date;
  /**
   * When the office actually handed this link over on WhatsApp.
   *
   * Different from "she opened it" and different from "she answered": it is the
   * only column that can answer "did we ever send this one", which is the first
   * question after a round that has gone quiet.
   */
  sentAt: Date | null;
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
  options: {
    includeArchived?: boolean;
    /**
     * Narrow to one round. Used by the round export and the round's nudge card,
     * both of which want the board's numbers for a batch's children and must not
     * arrive at them a second way — see coveredStudentsQuery.
     */
    batchId?: string;
  } = {},
): Promise<RequestBoardRow[]> {
  const rows = await db
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      audienceLabel: schema.requests.audienceLabel,
      audienceKind: schema.requests.audienceKind,
      teacher: schema.teachers.name,
      teacherId: schema.teachers.id,
      dueDate: schema.requests.dueDate,
      status: schema.requests.status,
      token: schema.requests.token,
      // contact_phone when the office overrode it for this request, her saved
      // number otherwise. One extra projection on a join that already exists.
      teacherPhone: sql<string>`coalesce(nullif(${schema.requests.contactPhone}, ''), ${schema.teachers.phone})`,
      contactPhone: sql<string | null>`nullif(${schema.requests.contactPhone}, '')`,
      fieldKeys: schema.requests.fieldKeys,
      teacherLinkToken: schema.teachers.linkToken,
      archivedAt: schema.requests.archivedAt,
      createdAt: schema.requests.createdAt,
      batchId: schema.requests.batchId,
      sentAt: schema.requests.sentAt,
    })
    .from(schema.requests)
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .where(
      and(
        options.includeArchived ? undefined : isNull(schema.requests.archivedAt),
        options.batchId ? eq(schema.requests.batchId, options.batchId) : undefined,
      ),
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
    teacherId: row.teacherId,
    dueDate: row.dueDate,
    status: row.status,
    token: row.token,
    teacherPhone: row.teacherPhone,
    contactPhone: row.contactPhone,
    fieldKeys: row.fieldKeys,
    teacherLinkToken: row.teacherLinkToken,
    rosterSize: sizes.get(row.id) ?? 0,
    studentsAnswered: answers.get(row.id) ?? 0,
    changesPending: changes.get(row.id) ?? 0,
    archivedAt: row.archivedAt,
    batchId: row.batchId,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  }));
}

/* ------------------------------------------------------- the board, grouped */

export type RequestBatch = typeof schema.requestBatches.$inferSelect;

/** A round, as one line on the board. */
export type BoardBatch = {
  kind: "batch";
  batchId: string;
  title: string;
  createdAt: Date;
  dueDate: string;
  /** Visible children. NOT the number the fan-out created — see below. */
  groups: number;
  /** Distinct teachers across them; fewer than `groups` in subject mode. */
  teachers: number;
  rosterSize: number;
  studentsAnswered: number;
  changesPending: number;
  /** Children where every child on the roster has been answered for. */
  groupsAnswered: number;
  /** Children the office has actually handed over on WhatsApp. */
  sentCount: number;
  closedCount: number;
  archivedCount: number;
  /** The first few group names, so the board still says what is inside. */
  sample: string[];
  /** Every child id, for the bulk bar. */
  requestIds: string[];
  status: "open" | "closed";
};

export type BoardEntry = ({ kind: "single" } & RequestBoardRow) | BoardBatch;

/**
 * Collapse a fan-out's children into one line.
 *
 * A round is one question asked of nineteen groups, and the board used to show
 * it as nineteen anonymous rows interleaved with everything else — nothing on
 * them said they were one thing, and the send queue that knows they are was
 * reachable only by the redirect immediately after the send.
 *
 * THE RULE THAT SETTLES EVERY EDGE CASE: a batch line is a view over exactly
 * the child rows it was given, and nothing else. It never counts a child the
 * caller filtered out, and it never reaches back to the database to find one.
 * Any other rule makes the board's "12 of 19 answered" disagree with what you
 * see on opening the round — and the whole point of the line is to be the same
 * fact, smaller. So under the default filter an archived child is simply gone:
 * a nineteen-group round with three swept reads as sixteen groups. Nothing is
 * lost, because getBatch applies no archived filter and the round's own page
 * always lists all nineteen, one tap away.
 *
 * PURE, and no database import, so the arithmetic that the board and the
 * round's own page must agree on can be tested without a connection.
 */
export function groupBoardRows(
  rows: RequestBoardRow[],
  batches: Map<string, RequestBatch>,
): BoardEntry[] {
  const grouped = new Map<string, RequestBoardRow[]>();
  const entries: BoardEntry[] = [];

  for (const row of rows) {
    /*
     * A child whose batch row is gone renders as a one-off, deliberately.
     * requests.batch_id is ON DELETE SET NULL, so a request can outlive its
     * round — and a line linking to /requests/batch/<id> for a batch that no
     * longer exists is a link to a 404. Showing the link itself is the honest
     * fallback: it is still a real request that still collected real answers.
     */
    if (!row.batchId || !batches.has(row.batchId)) {
      entries.push({ kind: "single", ...row });
      continue;
    }
    const siblings = grouped.get(row.batchId) ?? [];
    siblings.push(row);
    grouped.set(row.batchId, siblings);
  }

  for (const [batchId, unordered] of grouped) {
    const batch = batches.get(batchId)!;
    /*
     * Groups read in register order, not in the order the rows arrived.
     *
     * The board sorts newest first, and a fan-out creates its links ascending,
     * so a round's children arrive here reversed — "Class 10, Class 9, Class 8"
     * for a round that reads Class 6 to Class 10 everywhere else in the app.
     * compareClassLabels puts the nineteen real labels in timetable order and
     * falls through to a locale compare for a house or a route, so one call
     * covers every audience kind.
     */
    const children = unordered
      .slice()
      .sort((a, b) => compareClassLabels(a.audienceLabel, b.audienceLabel));

    const answered = children.filter(
      (child) => child.rosterSize > 0 && child.studentsAnswered >= child.rosterSize,
    );
    const closed = children.filter((child) => child.status === "closed");

    entries.push({
      kind: "batch",
      batchId,
      title: batch.title,
      createdAt: batch.createdAt,
      dueDate: batch.dueDate,
      groups: children.length,
      teachers: new Set(children.map((child) => child.teacherId)).size,
      rosterSize: sum(children, (child) => child.rosterSize),
      studentsAnswered: sum(children, (child) => child.studentsAnswered),
      changesPending: sum(children, (child) => child.changesPending),
      groupsAnswered: answered.length,
      sentCount: children.filter((child) => child.sentAt !== null).length,
      closedCount: closed.length,
      archivedCount: children.filter((child) => child.archivedAt !== null).length,
      sample: children.slice(0, 3).map((child) => child.audienceLabel),
      requestIds: children.map((child) => child.id),
      /*
       * Never 'expired'. Nothing in the codebase writes that value — it is read
       * by checkRequestAccess and derived from the due date, never stored — so a
       * line claiming it would be describing a state no child can be in.
       *
       * The partial case is not folded into one word either: the board shows
       * this alongside "3/5 closed" rather than picking a side, because a chip
       * that claims one state nineteen rows disagree about is worse than a chip
       * that says how they disagree.
       */
      status: closed.length === children.length ? "closed" : "open",
    });
  }

  // Newest first, exactly as the ungrouped board sorted. A round takes its own
  // created_at, which is written before any of its children (createBatch), so a
  // round never sorts above a request made after it.
  return entries.sort(
    (a, b) => dateOf(b).getTime() - dateOf(a).getTime(),
  );
}

const dateOf = (entry: BoardEntry) => entry.createdAt;

const sum = <T,>(items: T[], of: (item: T) => number) =>
  items.reduce((total, item) => total + of(item), 0);

/**
 * The board: one line per one-off request, one line per round.
 *
 * Two statements on top of what the board already paid. The batch rows are
 * looked up BY PRIMARY KEY for ids already present in the child set, so there
 * is no scan and request_batches needs no index for this.
 */
export async function listRequestBoard(
  options: { includeArchived?: boolean } = {},
): Promise<BoardEntry[]> {
  const rows = await listRequests(options);

  const batchIds = [
    ...new Set(rows.map((row) => row.batchId).filter((id): id is string => id !== null)),
  ];
  if (batchIds.length === 0) {
    return groupBoardRows(rows, new Map());
  }

  const batches = await db
    .select()
    .from(schema.requestBatches)
    .where(inArray(schema.requestBatches.id, batchIds));

  return groupBoardRows(rows, new Map(batches.map((batch) => [batch.id, batch])));
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
  /**
   * Which register this child came from, off the frozen snapshot.
   *
   * A class link's sheet is already named for its class, but a subject link is
   * eighty-four children from three registers and a house or route link spans
   * the school. Without this the file cannot say which one a name belongs to —
   * the same gap classesByRequest was written to close for the message.
   */
  classLabel: string | null;
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

  return { ...detail, rows: buildCollectedRows(detail.fields, roster, subs) };
}

type RosterEntry = typeof schema.requestStudents.$inferSelect;
type SubmissionRow = typeof schema.submissions.$inferSelect;

/**
 * Turn one link's frozen roster and its submissions into export rows.
 *
 * Shared by the per-request export and the whole-round one so that "later
 * submissions overwrite earlier ones for the same student and field" has a
 * single home. Both files show what was SENT beside what came back, because a
 * file carrying only the new value makes it impossible to see later what a
 * correction actually corrected.
 *
 * `fields` must be THIS LINK'S fields, not a round's union: in subject mode
 * each link asks for one `fa_*` key and its snapshot was narrowed to match, so
 * passing the union gives every sheet sixteen columns with fifteen blank.
 */
function buildCollectedRows(
  fields: FieldDef[],
  roster: RosterEntry[],
  subs: SubmissionRow[],
): CollectedRow[] {
  // Submissions arrive in submitted order, so the last write per key wins.
  const newest = new Map<string, SubmissionRow>();
  for (const row of subs) {
    newest.set(`${row.studentId}|${row.fieldKey}`, row);
  }

  const rows = roster.map((entry) => {
    const snapshot = entry.snapshot as {
      name?: string;
      srNo?: string | null;
      route?: string | null;
      classLabel?: string | null;
      values?: Record<string, string | null>;
    };

    const sent: Record<string, string | null> = {};
    const answered: Record<string, string | null> = {};
    const actions = new Set<string>();
    const statuses = new Set<string>();

    for (const field of fields) {
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
      classLabel: snapshot.classLabel ?? null,
      route: snapshot.route ?? null,
      sent,
      answered,
      outcome: describeOutcome(actions),
      reviewStatus: [...statuses].sort().join(", "),
    };
  });

  return rows.sort((a, b) => compareStudentNames(a.name, b.name));
}

/** One group's sheet in a round's workbook. */
export type CollectedGroup = {
  /** The board's row for this link — audience, teacher, and its numbers. */
  link: RequestBoardRow;
  /** What THIS link asked for, in registry order. */
  fields: FieldDef[];
  /** Distinct registers the children came from. */
  classLabels: string[];
  rows: CollectedRow[];
};

/**
 * Everything one send-to-many round collected, for export.
 *
 * SEVEN STATEMENTS IN THREE WAVES, flat in the number of links. Calling
 * collectedFor once per link would be six statements each — a thirty-eight link
 * marks round is well over two hundred round trips against a serverless
 * Postgres, which is a download the office would give up waiting for.
 *
 * The numbers come from listRequests, deliberately: they are the same numbers
 * the board shows, arrived at by the same query, so the file can never disagree
 * with the screen it was downloaded from. Nothing here forms a second opinion
 * about what "answered" means — see coveredStudentsQuery.
 *
 * `includeArchived` is on and that is not an oversight. An archived link still
 * collected real answers, and a round exported after the office has swept it
 * must still be the whole round. The board is where archiving hides things.
 */
export async function collectedForBatch(batchId: string): Promise<{
  batch: RequestBatch;
  groups: CollectedGroup[];
} | null> {
  const [batch] = await db
    .select()
    .from(schema.requestBatches)
    .where(eq(schema.requestBatches.id, batchId));
  if (!batch) return null;

  // One subquery, reused, so the roster and submission reads never wait on the
  // id list coming back first.
  const childIds = db
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.batchId, batchId));

  const [links, fields, roster, subs] = await Promise.all([
    listRequests({ batchId, includeArchived: true }),
    db
      .select()
      .from(schema.fieldDefs)
      .where(inArray(schema.fieldDefs.key, batch.fieldKeys))
      .orderBy(asc(schema.fieldDefs.sortOrder)),
    db
      .select()
      .from(schema.requestStudents)
      .where(inArray(schema.requestStudents.requestId, childIds)),
    db
      .select()
      .from(schema.submissions)
      .where(inArray(schema.submissions.requestId, childIds))
      .orderBy(asc(schema.submissions.submittedAt)),
  ]);

  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const rosterBy = groupBy(roster, (row) => row.requestId);
  const subsBy = groupBy(subs, (row) => row.requestId);

  const groups = links
    .slice()
    .sort((a, b) => compareClassLabels(a.audienceLabel, b.audienceLabel))
    .map((link) => {
      const own = link.fieldKeys
        .map((key) => fieldByKey.get(key))
        .filter((field): field is FieldDef => Boolean(field));
      const rows = buildCollectedRows(
        own,
        rosterBy.get(link.id) ?? [],
        subsBy.get(link.id) ?? [],
      );

      return {
        link,
        fields: own,
        classLabels: [
          ...new Set(
            rows
              .map((row) => row.classLabel)
              .filter((label): label is string => Boolean(label)),
          ),
        ].sort(compareClassLabels),
        rows,
      };
    });

  return { batch, groups };
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(keyOf(row)) ?? [];
    list.push(row);
    out.set(keyOf(row), list);
  }
  return out;
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

/**
 * Which classes each of these requests actually covers.
 *
 * A CLASS LINK ANSWERS THIS FROM ITS OWN LABEL. A subject link does not: one
 * link per (teacher, subject) merges every class that teacher takes for it, so
 * Hemlata's Chemistry link is one screen of eighty-four children drawn from
 * three classes — and until this existed, neither the WhatsApp message nor the
 * screen said so anywhere. She was asked to enter marks for eighty-four names
 * with no way to tell which register any of them came from.
 *
 * Read from the FROZEN ROSTER rather than from the fan-out that built the link.
 * The roster is what she will actually be shown; a class that has since moved a
 * child cannot make the message disagree with the list under it.
 */
export async function classesByRequest(
  ids: string[],
): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .selectDistinct({
      requestId: schema.requestStudents.requestId,
      classLabel: schema.students.classLabel,
    })
    .from(schema.requestStudents)
    .innerJoin(
      schema.students,
      eq(schema.students.id, schema.requestStudents.studentId),
    )
    .where(inArray(schema.requestStudents.requestId, ids));

  const byRequest = new Map<string, string[]>();
  for (const row of rows) {
    const list = byRequest.get(row.requestId) ?? [];
    list.push(row.classLabel);
    byRequest.set(row.requestId, list);
  }
  for (const list of byRequest.values()) list.sort(compareClassLabels);
  return byRequest;
}
