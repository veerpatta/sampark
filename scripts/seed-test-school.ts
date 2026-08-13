import "../drizzle/env";
import { hash } from "bcryptjs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray, notLike, sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import {
  TEST_PREFIX,
  TEST_SUBJECTS,
  TEST_TEACHERS,
  TEST_USER,
  testStudents,
} from "../drizzle/seed/test-school";

/**
 * Seed a small fake school for driving the console by hand or with smoke:ui.
 *
 *   npm run db:seed:test
 *
 * Idempotent: every write is an upsert on the primary key, so re-running
 * refreshes the fixtures rather than duplicating them.
 *
 * ---------------------------------------------------------------------------
 * THE GUARD IS THE POINT OF THIS FILE, NOT THE SEEDING.
 * ---------------------------------------------------------------------------
 *
 * This inserts invented children. Run against the real database it would put
 * ninety fake names alongside five hundred real ones, in a table whose whole
 * job is to be the one true record — and the two are indistinguishable on
 * screen once they are in. So before it writes anything it counts the rows that
 * are NOT test fixtures, and refuses outright if it finds any.
 *
 * A refusal is not overridable by a flag. A flag is a thing somebody types at
 * eleven at night to make an error message go away, and the error message here
 * is the only thing standing between a fixture run and the school's data.
 * Pointing it at a different database means pointing DATABASE_URL somewhere
 * else, deliberately, which is a decision rather than a keystroke.
 */

const PASSWORD_VAR = "TEST_LOGIN_PASSWORD";

/** The period the seeded marks round is filed under. */
const TEST_PERIOD = "2026-27/FA1";

/**
 * A real bcrypt hash that nothing can match — the same trick, and the same
 * reason, as NO_SUCH_USER_HASH in lib/auth/session.ts.
 *
 * The test account is created either way, because smoke:ui signs in by minting
 * a session rather than by typing a password and does not need one. Without
 * TEST_LOGIN_PASSWORD set, the account simply cannot be logged into by hand —
 * which is the right default for an account whose email is in a public repo.
 */
const UNUSABLE_HASH =
  "$2b$10$XOWKTJunJ2k.R2BW/QGaFOy8M.MWK1O.NPaCkgHh.7MkWqutBQJae";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const db = drizzle(neon(url), { schema });
  const endpoint = new URL(url).hostname.split(".")[0];

  console.log(`\nSeeding the test school into ${endpoint}\n`);

  await refuseIfRealDataIsPresent(db);

  const students = testStudents();

  await db
    .insert(schema.users)
    .values({
      ...TEST_USER,
      passwordHash: await passwordHash(),
      active: true,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        email: excluded("email"),
        name: excluded("name"),
        role: excluded("role"),
        passwordHash: excluded("password_hash"),
        active: excluded("active"),
      },
    });
  console.log(`  user      ${TEST_USER.email} (${TEST_USER.role})`);

  await db
    .insert(schema.teachers)
    .values(TEST_TEACHERS)
    .onConflictDoUpdate({
      target: schema.teachers.id,
      set: {
        name: excluded("name"),
        phone: excluded("phone"),
        classes: excluded("classes"),
        houses: excluded("houses"),
        routes: excluded("routes"),
        active: excluded("active"),
      },
    });
  console.log(`  teachers  ${TEST_TEACHERS.length}`);

  for (const chunk of chunked(students, 100)) {
    await db
      .insert(schema.students)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.students.id,
        set: {
          srNo: excluded("sr_no"),
          admissionNo: excluded("admission_no"),
          classLabel: excluded("class_label"),
          name: excluded("name"),
          fatherName: excluded("father_name"),
          motherName: excluded("mother_name"),
          phone: excluded("phone"),
          dob: excluded("dob"),
          gender: excluded("gender"),
          category: excluded("category"),
          aadhaarLast4: excluded("aadhaar_last4"),
          village: excluded("village"),
          busRoute: excluded("bus_route"),
          house: excluded("house"),
          status: excluded("status"),
          updatedAt: new Date(),
        },
      });
  }
  console.log(`  students  ${students.length}`);

  await db
    .insert(schema.teacherSubjects)
    .values(
      TEST_SUBJECTS.map((row) => ({ ...row, assignedBy: "office" as const })),
    )
    .onConflictDoUpdate({
      target: [
        schema.teacherSubjects.teacherId,
        schema.teacherSubjects.subjectKey,
        schema.teacherSubjects.classLabel,
      ],
      set: { updatedAt: new Date() },
    });
  console.log(`  subjects  ${TEST_SUBJECTS.length} assignments`);

  await seedRounds();

  console.log(`\nSign in as  ${TEST_USER.email}`);
  if (process.env[PASSWORD_VAR]) {
    console.log(`Password    the ${PASSWORD_VAR} in your .env.local\n`);
  } else {
    console.log(
      `Password    NOT SET — this account cannot be signed into by hand.\n` +
        `            Add ${PASSWORD_VAR}=<something> to .env.local and re-run\n` +
        `            to set one. \`npm run smoke:ui\` does not need it.\n`,
    );
  }

  process.exit(0);
}

/**
 * A marks round half done, and a phone round waiting to be reviewed.
 *
 * WITHOUT THIS THE FIXTURES ARE UNUSABLE for the thing they exist for. Every
 * board in the console is a view over rounds, so a school with no rounds gives
 * you fourteen empty screens and no way to tell a working one from a broken
 * one. The state seeded here is the state worth looking at: one teacher
 * finished, one who has not started, and one correction sitting in the queue —
 * which is also the pair that shows marks and master data taking different
 * paths, side by side, on two screens.
 *
 * Written through createRequest and recordSubmissions rather than by INSERT, so
 * the fixtures go through the same code a teacher's phone does. A seed that
 * hand-assembled rows could construct a state the application cannot reach, and
 * then every screen built against it would be built against a lie.
 */
async function seedRounds() {
  // Idempotent the only way it can be: this script's own rounds go first.
  // submissions is append-only to app_rw, which is why this runs as owner.
  await dropPreviousRounds();

  const { createRequest } = await import("../src/lib/requests");
  const { recordSubmissions } = await import("../src/lib/submissions");
  const { resolveToken } = await import("../src/lib/auth/token");

  const due = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  const common = { dueDate: due, createdBy: TEST_USER.id };

  // Sunita has done most of her class; Hemlata has not opened hers.
  const maths = await createRequest({
    ...common,
    title: "FA1 marks — Maths",
    classLabel: "Class 8",
    teacherId: `${TEST_PREFIX}T-sunita`,
    fieldKeys: ["fa_maths"],
    period: TEST_PERIOD,
  });
  await createRequest({
    ...common,
    title: "FA1 marks — Science",
    classLabel: "Class 8",
    teacherId: `${TEST_PREFIX}T-hemlata`,
    fieldKeys: ["fa_science"],
    period: TEST_PERIOD,
  });

  const mathsRound = await resolveToken(maths.token);
  await recordSubmissions(
    mathsRound!,
    mathsRound!.roster.slice(0, 19).map((row, i) => ({
      studentId: row.studentId,
      values: { fa_maths: String(11 + ((i * 3) % 15)) },
    })),
    null,
    "seed-maths",
  );

  // And one master-data round, so /review is not empty either — the contrast
  // between the two screens is the thing somebody is here to look at.
  const phones = await createRequest({
    ...common,
    title: "Check parent mobile numbers",
    classLabel: "Class 9",
    teacherId: `${TEST_PREFIX}T-hemlata`,
    fieldKeys: ["phone"],
  });
  const phoneRound = await resolveToken(phones.token);
  await recordSubmissions(
    phoneRound!,
    phoneRound!.roster.slice(0, 4).map((row, i) => ({
      studentId: row.studentId,
      values: { phone: `99911${String(10000 + i).slice(-5)}` },
    })),
    null,
    "seed-phones",
  );

  console.log(`  rounds    3 (marks 19/24 entered, 4 phone changes to review)`);
  console.log(`\n  Teacher links, no login needed:`);
  console.log(`    Sunita, Class 8 maths   /r/${maths.token}`);
  console.log(`    Hemlata, Class 9 phones /r/${phones.token}`);
}

/** This script's own previous rounds, so a re-run refreshes rather than piles up. */
async function dropPreviousRounds() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!;
  const owner = drizzle(neon(url), { schema });

  const mine = await owner
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.createdBy, TEST_USER.id));

  const ids = mine.map((row) => row.id);
  if (ids.length === 0) return;

  const subs = await owner
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .where(inArray(schema.submissions.requestId, ids));

  if (subs.length > 0) {
    await owner.delete(schema.changeLog).where(
      inArray(schema.changeLog.submissionId, subs.map((row) => row.id)),
    );
  }
  await owner
    .delete(schema.studentRecords)
    .where(inArray(schema.studentRecords.requestId, ids));
  await owner
    .delete(schema.submissions)
    .where(inArray(schema.submissions.requestId, ids));
  await owner
    .delete(schema.requestStudents)
    .where(inArray(schema.requestStudents.requestId, ids));
  await owner.delete(schema.requests).where(inArray(schema.requests.id, ids));
}

/**
 * Count everything that is not a fixture, and stop if there is any.
 *
 * Students and teachers separately, because either one alone means this is a
 * real database: a branch restored from production has both, and a branch
 * somebody has been importing into may have students before it has staff.
 */
async function refuseIfRealDataIsPresent(db: ReturnType<typeof drizzle>) {
  const [students, teachers] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.students)
      .where(notLike(schema.students.id, `${TEST_PREFIX}%`)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.teachers)
      .where(notLike(schema.teachers.id, `${TEST_PREFIX}%`)),
  ]);

  const real = (students[0]?.n ?? 0) + (teachers[0]?.n ?? 0);
  if (real === 0) return;

  console.error(
    `\nREFUSED. This database holds ${students[0]?.n ?? 0} students and ` +
      `${teachers[0]?.n ?? 0} teachers that are not test fixtures.\n\n` +
      `That makes it a real database, and this script invents children. Point\n` +
      `DATABASE_URL at a development branch and run it there.\n\n` +
      `There is deliberately no flag to override this.\n`,
  );
  process.exit(1);
}

async function passwordHash(): Promise<string> {
  const supplied = process.env[PASSWORD_VAR];
  return supplied ? hash(supplied, 10) : UNUSABLE_HASH;
}

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
