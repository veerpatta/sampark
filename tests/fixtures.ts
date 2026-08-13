import "../drizzle/env";
import { eq, inArray, like } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { db, schema } from "../src/lib/db";
import { generateToken } from "../src/lib/auth/token";
import { buildSnapshots } from "../src/lib/snapshots";
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
      audienceKind: "class",
      audienceLabel: TEST_CLASS,
      teacherId,
      fieldKeys,
      period: options?.period ?? null,
      dueDate: futureDate(),
      createdBy: userId,
    })
    .returning({ id: schema.requests.id });

  // Sorted, because Postgres does not promise an order without one and every
  // test here reaches for `roster[0]` expecting the first child. It held by
  // luck until an UPDATE rewrote a tuple and moved it down the heap, at which
  // point a test asserting on child one silently started asserting on child two.
  const students = (
    await db
      .select()
      .from(schema.students)
      .where(inArray(schema.students.id, studentIds))
  ).sort((a, b) => a.id.localeCompare(b.id));

  const fields = await db
    .select()
    .from(schema.fieldDefs)
    .where(inArray(schema.fieldDefs.key, fieldKeys));

  // The real builder, not a copy of it. A hand-rolled snapshot here would drift
  // from production silently, and the snapshot is the thing every review
  // decision is compared against.
  const snapshots = buildSnapshots(students, fields, new Map());

  await db.insert(schema.requestStudents).values(
    students.map((student) => ({
      requestId: request!.id,
      studentId: student.id,
      rollNo: student.rollNo,
      snapshot: snapshots.get(student.id)!,
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
      audienceLabel: TEST_CLASS,
      period: options?.period ?? null,
      dueDate: futureDate(),
      status: "open",
      teacherName: "Test Teacher",
      fields: ordered,
      classLabels: [TEST_CLASS],
      // Read back off the same snapshots that were frozen above, so what a test
      // hands to recordSubmissions is exactly what the teacher would have seen.
      roster: students.map((student) => {
        const snapshot = snapshots.get(student.id)!;
        return { studentId: student.id, ...snapshot };
      }),
    },
  };
}

export type FanOutScenario = {
  userId: string;
  /** Two groups, each with exactly one owning teacher and two students. */
  groups: {
    classLabel: string;
    teacherId: string;
    teacherName: string;
    studentIds: string[];
  }[];
  /**
   * The house names actually written, in the order they were asked for.
   *
   * ASSERT AGAINST THESE, never against the literal you passed in — see the
   * note on `houses` in createFanOutScenario. Empty when none were requested.
   */
  houses: (string | null)[];
};

/**
 * A school in miniature: two classes, one teacher each, two children each.
 *
 * The class labels are fixture-only strings rather than real ones. A fan-out
 * groups by whatever is in students.class_label and resolves the owner from
 * teachers.classes, so a real class here would pull in real students and any
 * real teacher who owns it — turning "one owner" into "two owners" and blocking
 * the group. Isolating the vocabulary makes the test deterministic against
 * whatever the dev database happens to hold.
 *
 * `houses` GETS THE SAME TREATMENT, and for the same reason — it did not always,
 * and the day the dev branch acquired a teacher holding Rana Pratap the
 * house-wide test started failing on data it had never heard of. A house name
 * passed in here is a LABEL, not a literal: it is suffixed before it is written,
 * so two groups asking for the same name land in the same house and two asking
 * for different ones do not, while neither can collide with a real house. Read
 * the names back off `scenario.houses`.
 */
export async function createFanOutScenario(options?: {
  houses?: (string | null)[];
}): Promise<FanOutScenario> {
  const suffix = generateToken().slice(0, 6).replace(/[^A-Za-z0-9]/g, "x");
  const userId = `${PREFIX}U${suffix}`;
  const house = (label: string | null) =>
    label === null ? null : `${PREFIX}H${label.replace(/[^A-Za-z0-9]/g, "")}${suffix}`;
  const houses = options?.houses?.map(house) ?? [];

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId.toLowerCase()}@example.invalid`,
    name: "Test Office",
    passwordHash: "not-a-real-hash",
    role: "admin",
  });

  const groups = [0, 1].map((index) => ({
    classLabel: `${PREFIX}CLASS${index}${suffix}`,
    teacherId: `${PREFIX}T${index}${suffix}`,
    teacherName: `Test Teacher ${index}`,
    studentIds: [
      `${PREFIX}S${index}A${suffix}`,
      `${PREFIX}S${index}B${suffix}`,
    ],
  }));

  await db.insert(schema.teachers).values(
    groups.map((group) => ({
      id: group.teacherId,
      name: group.teacherName,
      phone: "9000000000",
      classes: [group.classLabel],
    })),
  );

  await db.insert(schema.students).values(
    groups.flatMap((group, index) =>
      group.studentIds.map((id, position) => ({
        id,
        name: `Test Child ${index}${position}`,
        classLabel: group.classLabel,
        phone: position === 0 ? "9111111111" : null,
        fatherName: `Test Father ${index}${position}`,
        house: houses[index] ?? null,
      })),
    ),
  );

  return { userId, groups, houses };
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
  // Batches after their requests: requests.batch_id is ON DELETE SET NULL, so a
  // batch row outlives the links it created rather than cascading with them.
  await ownerDb
    .delete(schema.requestBatches)
    .where(like(schema.requestBatches.createdBy, `${PREFIX}%`));
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

/** What is actually stored for a student — marks and one-off answers. */
export async function recordsFor(studentId: string) {
  return db
    .select()
    .from(schema.studentRecords)
    .where(eq(schema.studentRecords.studentId, studentId));
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
