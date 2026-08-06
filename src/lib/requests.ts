import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { generateToken } from "./auth/token";
import {
  compareStudentNames,
  isClassLabel,
  normaliseClassLabel,
  unknownClassLabelMessage,
} from "./classes";
import { listClassRoster } from "./students";
import { readStudentColumn } from "./student-columns";
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
 * Exactly what one student's row on the teacher's phone was prefilled with.
 *
 * `srNo` and `route` are the only identifying context that exists. There are no
 * roll numbers and no parent names in the real data, so the card carries the SR
 * number — the one stable thing she can cross-check against a paper register —
 * and the bus route, which in a village school tells her which child this is for
 * the half of them who have one.
 */
export type RosterSnapshot = {
  name: string;
  srNo: string | null;
  route: string | null;
  /** Keyed by field_defs.key. null means "we hold nothing for this field". */
  values: Record<string, string | null>;
};

export type CreateRequestInput = {
  title: string;
  classLabel: string;
  teacherId: string;
  fieldKeys: string[];
  period?: string | null;
  dueDate: string;
  createdBy: string;
};

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export async function createRequest(input: CreateRequestInput): Promise<{
  id: string;
  token: string;
  rosterSize: number;
}> {
  const title = input.title.trim();
  const classLabel = normaliseClassLabel(input.classLabel);
  const fieldKeys = [...new Set(input.fieldKeys.map((key) => key.trim()).filter(Boolean))];

  if (!title) throw new RequestValidationError("Give the request a title.");
  if (!classLabel) throw new RequestValidationError("Pick a class.");
  // A label off the list would match no student and freeze an empty roster
  // without raising anything. Refuse before a token is even generated.
  if (!isClassLabel(classLabel)) {
    throw new RequestValidationError(unknownClassLabelMessage(classLabel));
  }
  if (fieldKeys.length === 0) {
    throw new RequestValidationError("Pick at least one field to ask about.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    throw new RequestValidationError("Pick a due date.");
  }

  const [teacher] = await db
    .select()
    .from(schema.teachers)
    .where(eq(schema.teachers.id, input.teacherId))
    .limit(1);

  if (!teacher) throw new RequestValidationError("That teacher does not exist.");
  if (!teacher.active) {
    throw new RequestValidationError(`${teacher.name} is marked inactive.`);
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

  // A collect-mode field lands in student_records, which is keyed by period.
  // Without one there is nowhere for the answer to go.
  const period = input.period?.trim() || null;
  const needsPeriod = fields.some((field) => field.targetColumn === null);
  if (needsPeriod && !period) {
    throw new RequestValidationError(
      "Collecting marks needs a period, for example 2026-27/FA1.",
    );
  }

  const roster = await listClassRoster(classLabel);
  if (roster.length === 0) {
    throw new RequestValidationError(
      `No active students in class ${classLabel}. Import the class first.`,
    );
  }

  const snapshots = await buildSnapshots(roster, fields, period);
  const token = await uniqueToken();

  const [request] = await db
    .insert(schema.requests)
    .values({
      token,
      title,
      classLabel,
      teacherId: teacher.id,
      fieldKeys,
      period,
      dueDate: input.dueDate,
      createdBy: input.createdBy,
    })
    .returning({ id: schema.requests.id });

  if (!request) throw new Error("Request insert returned nothing.");

  // The roster is written immediately after, in chunks. A request whose roster
  // failed to write would open to an empty list on the teacher's phone, so if
  // this throws we delete the request rather than leave that behind.
  try {
    const rows = roster.map((student) => ({
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

  return { id: request.id, token, rosterSize: roster.length };
}

/**
 * Freeze the current value of every requested field for every student.
 *
 * Master fields read from the students row. Fields with no target column are
 * period-scoped and read from student_records — re-sending an FA request for a
 * period already partly filled should show the teacher what is already there
 * rather than a blank column.
 */
async function buildSnapshots(
  roster: Student[],
  fields: FieldDef[],
  period: string | null,
): Promise<Map<string, RosterSnapshot>> {
  const recordFields = fields.filter((field) => field.targetColumn === null);
  const priorRecords = new Map<string, string | null>();

  if (recordFields.length > 0 && period) {
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
      priorRecords.set(`${row.studentId}:${row.fieldKey}`, row.value);
    }
  }

  const snapshots = new Map<string, RosterSnapshot>();

  for (const student of roster) {
    const values: Record<string, string | null> = {};

    for (const field of fields) {
      // readStudentColumn, not a raw lookup: target_column is a database name
      // and a Drizzle row is keyed by property name. See student-columns.ts.
      values[field.key] = field.targetColumn
        ? readStudentColumn(student, field.targetColumn)
        : (priorRecords.get(`${student.id}:${field.key}`) ?? null);
    }

    snapshots.set(student.id, {
      name: student.name,
      srNo: student.srNo,
      route: student.busRoute,
      values,
    });
  }

  return snapshots;
}

/**
 * 96 bits of entropy makes a collision a non-event, but a duplicate token would
 * be a silent cross-class data leak, so check rather than assume.
 */
async function uniqueToken(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateToken();
    const [clash] = await db
      .select({ token: schema.requests.token })
      .from(schema.requests)
      .where(eq(schema.requests.token, token))
      .limit(1);
    if (!clash) return token;
  }
  throw new Error("Could not generate a unique token.");
}

/* ------------------------------------------------------------------ boards */

export type RequestBoardRow = {
  id: string;
  title: string;
  classLabel: string;
  teacher: string;
  dueDate: string;
  status: string;
  rosterSize: number;
  studentsAnswered: number;
  changesPending: number;
};

/** The status board. Reads the request_progress view from plan section 4.3. */
export async function listRequests(): Promise<RequestBoardRow[]> {
  const rows = await db
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      classLabel: schema.requests.classLabel,
      teacher: schema.teachers.name,
      dueDate: schema.requests.dueDate,
      status: schema.requests.status,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
    .orderBy(desc(schema.requests.createdAt));

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

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
      .select({
        requestId: schema.submissions.requestId,
        n: sql<number>`count(distinct ${schema.submissions.studentId})::int`,
      })
      .from(schema.submissions)
      .where(inArray(schema.submissions.requestId, ids))
      .groupBy(schema.submissions.requestId),
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
    classLabel: row.classLabel,
    teacher: row.teacher,
    dueDate: row.dueDate,
    status: row.status,
    rosterSize: sizes.get(row.id) ?? 0,
    studentsAnswered: answers.get(row.id) ?? 0,
    changesPending: changes.get(row.id) ?? 0,
  }));
}

/**
 * Who on this roster has not answered yet.
 *
 * Feeds the reminder builder. "Answered" means any submission at all — a
 * confirmation counts, because the teacher has done the work either way.
 */
export async function listNonResponders(requestId: string): Promise<
  { studentId: string; rollNo: number | null; name: string }[]
> {
  const [roster, answered] = await Promise.all([
    db
      .select()
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, requestId)),
    db
      .selectDistinct({ studentId: schema.submissions.studentId })
      .from(schema.submissions)
      .where(eq(schema.submissions.requestId, requestId)),
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

  const [fields, roster] = await Promise.all([
    db
      .select()
      .from(schema.fieldDefs)
      .where(inArray(schema.fieldDefs.key, row.request.fieldKeys))
      .orderBy(asc(schema.fieldDefs.sortOrder)),
    db
      .select({ studentId: schema.requestStudents.studentId })
      .from(schema.requestStudents)
      .where(eq(schema.requestStudents.requestId, id)),
  ]);

  return { ...row, fields, rosterSize: roster.length };
}
