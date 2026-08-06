import "../drizzle/env";
import { eq, inArray, like } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { db, schema } from "../src/lib/db";
import { generateToken } from "../src/lib/auth/token";
import { readStudentColumn } from "../src/lib/student-columns";
import type { ResolvedRequest } from "../src/lib/auth/token";

/**
 * Teardown runs as the OWNER, not as app_rw.
 *
 * app_rw cannot DELETE from submissions or change_log — that is the append-only
 * enforcement from plan section 4.2, and it is not negotiable just because a
 * test wants a clean slate. Discovering this by having the teardown refused was
 * a useful accident: the guarantee is real, not aspirational.
 *
 * Clearing up after a test is a maintenance operation, so it takes the same
 * connection a migration would.
 */
const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
if (!ownerUrl) {
  throw new Error(
    "DATABASE_URL_UNPOOLED must be set — test teardown deletes append-only rows and needs the owner role.",
  );
}
const ownerDb = drizzle(neon(ownerUrl), { schema });

/**
 * Live-database fixtures for the review-transaction tests.
 *
 * These tests hit the real Neon dev database, because the thing under test IS
 * the transaction — a mocked one would prove nothing about whether the
 * `AND review_status = 'pending'` guard actually makes a double approval a
 * no-op, which is the whole reason these tests exist.
 *
 * Everything created here is prefixed ZZTEST and torn down afterwards. Every
 * value is invented: no real student, teacher or number appears (rule 12).
 */
/**
 * Every fixture is prefixed ZZTEST and torn down afterwards — but the prefix
 * also carries the TEST FILE, because `node --test` runs files in parallel and
 * a shared prefix means one file's `cleanup()` deletes another file's students
 * out from under it. That surfaced as a foreign-key violation on
 * request_students: not a flaky test, two teardowns racing.
 *
 * Five characters of the filename is enough to separate them and keeps the ids
 * inside the column widths.
 */
const FILE_TAG = (process.argv[1] ?? "x")
  .replace(/\\/g, "/")
  .split("/")
  .pop()!
  .replace(/\.test\.ts$/, "")
  .replace(/[^a-z]/gi, "")
  .slice(0, 5)
  .toUpperCase()
  .padEnd(5, "X");

const PREFIX = `ZZTEST${FILE_TAG}`;

/**
 * Fixture students need a class the request builder will accept, because
 * createRequest validates against the canonical nineteen. The smallest real
 * class keeps the roster a request freezes small — the fixtures' own students
 * are always found by id, so any real students sharing the class are simply
 * along for the ride.
 */
export const TEST_CLASS = "12 Commerce";

export type Scenario = {
  requestId: string;
  token: string;
  resolved: ResolvedRequest;
  studentIds: string[];
  userId: string;
  teacherId: string;
};

export async function createScenario(options?: {
  fieldKeys?: string[];
  period?: string | null;
}): Promise<Scenario> {
  const fieldKeys = options?.fieldKeys ?? ["phone", "father_name"];
  const suffix = generateToken().slice(0, 6).replace(/[^A-Za-z0-9]/g, "x");

  const userId = `${PREFIX}U${suffix}`;
  const teacherId = `${PREFIX}T${suffix}`;
  const studentIds = [`${PREFIX}S1${suffix}`, `${PREFIX}S2${suffix}`];

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId.toLowerCase()}@example.invalid`,
    name: "Test Reviewer",
    passwordHash: "not-a-real-hash",
    role: "admin",
  });

  await db.insert(schema.teachers).values({
    id: teacherId,
    name: "Test Teacher",
    phone: "9000000000",
    classes: [TEST_CLASS],
  });

  await db.insert(schema.students).values([
    {
      id: studentIds[0]!,
      name: "Test Child One",
      classLabel: TEST_CLASS,
      rollNo: 1,
      phone: "9111111111",
      fatherName: "Test Father One",
    },
    {
      id: studentIds[1]!,
      name: "Test Child Two",
      classLabel: TEST_CLASS,
      rollNo: 2,
      phone: null,
      fatherName: "Test Father Two",
    },
  ]);

  const token = generateToken();
  const [request] = await db
    .insert(schema.requests)
    .values({
      token,
      title: "Test request",
      classLabel: TEST_CLASS,
      teacherId,
      fieldKeys,
      period: options?.period ?? null,
      dueDate: futureDate(),
      createdBy: userId,
    })
    .returning({ id: schema.requests.id });

  const students = await db
    .select()
    .from(schema.students)
    .where(inArray(schema.students.id, studentIds));

  const fields = await db
    .select()
    .from(schema.fieldDefs)
    .where(inArray(schema.fieldDefs.key, fieldKeys));

  await db.insert(schema.requestStudents).values(
    students.map((student) => ({
      requestId: request!.id,
      studentId: student.id,
      rollNo: student.rollNo,
      snapshot: {
        name: student.name,
        srNo: student.srNo,
        route: student.busRoute,
        house: student.house,
        fatherName: student.fatherName,
        values: Object.fromEntries(
          fields.map((field) => [
            field.key,
            field.targetColumn
              ? readStudentColumn(student, field.targetColumn)
              : null,
          ]),
        ),
      },
    })),
  );

  const ordered = fieldKeys
    .map((key) => fields.find((field) => field.key === key)!)
    .filter(Boolean);

  return {
    requestId: request!.id,
    token,
    userId,
    teacherId,
    studentIds,
    resolved: {
      requestId: request!.id,
      title: "Test request",
      classLabel: TEST_CLASS,
      period: options?.period ?? null,
      dueDate: futureDate(),
      status: "open",
      teacherName: "Test Teacher",
      fields: ordered,
      roster: students.map((student) => ({
        studentId: student.id,
        srNo: student.srNo,
        name: student.name,
        route: student.busRoute,
        house: student.house,
        fatherName: student.fatherName,
        values: Object.fromEntries(
          ordered.map((field) => [
            field.key,
            field.targetColumn
              ? readStudentColumn(student, field.targetColumn)
              : null,
          ]),
        ),
      })),
    },
  };
}

/** Remove everything any scenario has ever created, in dependency order. */
export async function cleanup() {
  const requests = await ownerDb
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(like(schema.requests.createdBy, `${PREFIX}%`));

  const ids = requests.map((row) => row.id);

  if (ids.length > 0) {
    const subs = await ownerDb
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(inArray(schema.submissions.requestId, ids));

    if (subs.length > 0) {
      await ownerDb.delete(schema.changeLog).where(
        inArray(
          schema.changeLog.submissionId,
          subs.map((row) => row.id),
        ),
      );
      await ownerDb
        .delete(schema.submissions)
        .where(inArray(schema.submissions.requestId, ids));
    }

    await ownerDb
      .delete(schema.studentRecords)
      .where(inArray(schema.studentRecords.requestId, ids));
    await ownerDb
      .delete(schema.requestStudents)
      .where(inArray(schema.requestStudents.requestId, ids));
    await ownerDb.delete(schema.requests).where(inArray(schema.requests.id, ids));
  }

  await ownerDb
    .delete(schema.studentRecords)
    .where(like(schema.studentRecords.studentId, `${PREFIX}%`));
  // Also by STUDENT, not only by the requests found above. A roster row can
  // outlive the query that found its request — a request created in an earlier
  // run, or one whose creator was cleaned up first — and the only symptom is a
  // foreign-key violation here, at teardown, which reads like a flaky test and
  // is not one.
  await ownerDb
    .delete(schema.requestStudents)
    .where(like(schema.requestStudents.studentId, `${PREFIX}%`));
  await ownerDb
    .delete(schema.students)
    .where(like(schema.students.id, `${PREFIX}%`));
  await ownerDb
    .delete(schema.teachers)
    .where(like(schema.teachers.id, `${PREFIX}%`));
  await ownerDb.delete(schema.users).where(like(schema.users.id, `${PREFIX}%`));
}

export async function studentById(id: string) {
  const [row] = await db
    .select()
    .from(schema.students)
    .where(eq(schema.students.id, id));
  return row;
}

export async function submissionsFor(requestId: string) {
  return db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.requestId, requestId));
}

export async function changeLogFor(submissionIds: string[]) {
  if (submissionIds.length === 0) return [];
  return db
    .select()
    .from(schema.changeLog)
    .where(inArray(schema.changeLog.submissionId, submissionIds));
}

function futureDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return date.toISOString().slice(0, 10);
}
