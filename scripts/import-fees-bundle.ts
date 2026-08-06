import "../drizzle/env";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { parseTabularFile, excelSerialToDate } from "../src/lib/excel";
import { applySourcedPlan, planSourcedImport } from "../src/lib/import-plan";
import { IMPORT_COLUMNS, type StudentColumn } from "../src/lib/students-import";
import { STUDENT_COLUMN_BY_DB_NAME } from "../src/lib/student-columns";
import { compareClassLabels } from "../src/lib/classes";
import { db, schema } from "../src/lib/db";

/**
 * Refresh the master record from a VPPS Fee Management App context bundle.
 *
 *     npx tsx scripts/import-fees-bundle.ts private/students-2026-27.xlsx
 *     npx tsx scripts/import-fees-bundle.ts private/students-2026-27.xlsx --apply
 *     npx tsx scripts/import-fees-bundle.ts private/students-2026-27.xlsx --apply --remove-missing
 *
 * The bundle is the fee app's whole world in fourteen sheets; only `Students`
 * is read. It arrives as `fees`, so precedence decides what it may touch: the
 * fee app owns class, section, status and bus route, PSP owns who the child is,
 * and an approved teacher correction outranks both. None of that is decided
 * here — see lib/precedence.ts.
 *
 * TWO THINGS THIS FILE EXISTS TO GET RIGHT
 * ----------------------------------------
 * 1. THE BUNDLE'S "Student ID" IS NOT OURS. It is the fee app's internal UUID
 *    and it is deliberately not mapped. `students.id` holds a PSP id, and the
 *    two identity spaces do not overlap by a single row — mapping the UUID
 *    across (which the /students/import auto-mapper will happily suggest,
 *    because the header spells "Student ID") matches nothing and turns a
 *    routine refresh into 531 duplicate children. Rows match on SR NUMBER.
 *
 * 2. --remove-missing DELETES. Everything else here proposes; this does not.
 *    A student in the master record but absent from the bundle has left the
 *    school, and the school's own system is the thing that knows it. The rows
 *    are dumped to private/archive first, because the alternative to a dump is
 *    a Neon PITR window that is six hours long.
 */

/** Bundle header -> `students` property. `Student ID` is absent on purpose. */
const HEADER_TO_COLUMN: Record<string, StudentColumn> = {
  "SR no": "srNo",
  Student: "name",
  Class: "classLabel",
  Status: "status",
  Route: "busRoute",
  "Father name": "fatherName",
  "Mother name": "motherName",
  "Father phone": "phone",
  "Mother phone": "altPhone",
  "Date of birth": "dob",
};

/**
 * The fee app writes this in the route column for a child who does not take the
 * bus. It is the absence of a route, not the name of one, and storing it would
 * put nine students on a bus called "No Transport".
 */
const NOT_A_ROUTE = new Set(["no transport", "none", "self", "-"]);

const NORMALISE = new Map(
  IMPORT_COLUMNS.map((spec) => [spec.column, spec.normalise]),
);
const DB_NAME_BY_PROPERTY = new Map(
  [...STUDENT_COLUMN_BY_DB_NAME].map(([dbName, property]) => [property, dbName]),
);

type BundleRow = {
  srNo: string;
  name: string;
  classLabel: string;
  /** Keyed by DB column name, which is what planSourcedImport speaks. */
  values: Record<string, string | null>;
  warnings: string[];
};

async function main() {
  const apply = process.argv.includes("--apply");
  const removeMissing = process.argv.includes("--remove-missing");
  const path = process.argv[2];

  if (!path) {
    console.error("usage: import-fees-bundle.ts <bundle.xlsx> [--apply] [--remove-missing]");
    process.exit(1);
  }

  const buffer = await readFile(path);
  const table = await parseTabularFile(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
    path,
    "Students",
  );

  console.log(`${path}`);
  console.log(`  sheet "${table.sheet}" of ${table.sheets?.length ?? 0}: ${table.rows.length} rows`);

  const unmappable = Object.keys(HEADER_TO_COLUMN).filter(
    (header) => !table.headers.includes(header),
  );
  if (unmappable.length > 0) {
    console.error(
      `\nThis is not a students bundle — missing columns: ${unmappable.join(", ")}`,
    );
    process.exit(1);
  }

  const { rows, problems } = readBundle(table.rows);
  console.log(`  usable rows: ${rows.length}`);
  for (const problem of problems) console.log(`  ! ${problem}`);

  // ---- match on SR number, never on name, never on the fee app's UUID ----
  const master = await db
    .select({ id: schema.students.id, srNo: schema.students.srNo, name: schema.students.name, classLabel: schema.students.classLabel })
    .from(schema.students);

  const idBySr = new Map<string, string>();
  for (const student of master) {
    if (student.srNo) idBySr.set(student.srNo, student.id);
  }

  const incoming = rows.map((row) => ({
    // A new admission has no record yet, so its SR number becomes its id. That
    // is the same rule the /students/import screen uses and the reason
    // re-running this file updates rather than duplicating.
    studentId: idBySr.get(row.srNo) ?? row.srNo,
    values: row.values,
    warnings: row.warnings,
  }));

  const plan = await planSourcedImport("fees", incoming, { allowInsert: true });

  console.log(`\n--- what the fee app would do ------------------------`);
  console.log(`  insert (new admissions)      ${plan.counts.insert}`);
  console.log(`  update                       ${plan.counts.update}`);
  console.log(`  already correct              ${plan.counts.skip}`);
  console.log(`  refused by precedence        ${plan.counts.blocked}`);
  console.log(`  error                        ${plan.counts.error}`);

  const changedFields = new Map<string, number>();
  for (const row of plan.rows) {
    for (const change of row.changes) {
      changedFields.set(change.fieldKey, (changedFields.get(change.fieldKey) ?? 0) + 1);
    }
  }
  if (changedFields.size > 0) {
    console.log(`\nfields that would change:`);
    for (const [field, n] of [...changedFields].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field.padEnd(14)} ${n}`);
    }
  }

  const blockedReasons = new Map<string, number>();
  for (const row of plan.rows) {
    for (const blocked of row.blocked) {
      const reason = `${blocked.fieldKey}: ${blocked.blockedBy}`;
      blockedReasons.set(reason, (blockedReasons.get(reason) ?? 0) + 1);
    }
  }
  if (blockedReasons.size > 0) {
    console.log(`\nrefused, and by whom — this is the system working:`);
    for (const [reason, n] of [...blockedReasons].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${reason}`);
    }
  }

  // ---- who is in the master record but no longer in the bundle ----
  const bundleSrs = new Set(rows.map((row) => row.srNo));
  const missing = master.filter(
    (student) => !student.srNo || !bundleSrs.has(student.srNo),
  );

  console.log(`\n--- in the master record, not in this bundle ---------`);
  console.log(`  ${missing.length} students`);
  for (const student of [...missing].sort(
    (a, b) => compareClassLabels(a.classLabel, b.classLabel) || a.name.localeCompare(b.name),
  )) {
    console.log(`  ${student.classLabel.padEnd(12)} sr ${String(student.srNo ?? "—").padEnd(11)} ${student.name}`);
  }

  if (!apply) {
    console.log(`\ndry run only — pass --apply to write`);
    if (missing.length > 0 && !removeMissing) {
      console.log(`and --remove-missing to delete the ${missing.length} above`);
    }
    return;
  }

  const written = await applySourcedPlan(plan);
  console.log(`\nwritten: ${JSON.stringify(written)}`);

  if (removeMissing && missing.length > 0) {
    const result = await removeStudents(missing.map((student) => student.id), path);
    console.log(`removed: ${JSON.stringify(result)}`);
  }
}

/** Map, normalise and validate the sheet. Bad cells warn; bad rows are dropped. */
function readBundle(raw: Record<string, string>[]): {
  rows: BundleRow[];
  problems: string[];
} {
  const rows: BundleRow[] = [];
  const problems: string[] = [];
  const seenSr = new Set<string>();

  raw.forEach((source, index) => {
    // +2: row 1 is the header, and spreadsheets count from 1.
    const rowNumber = index + 2;
    const values: Record<string, string | null> = {};
    const warnings: string[] = [];

    for (const [header, property] of Object.entries(HEADER_TO_COLUMN)) {
      let cell = (source[header] ?? "").trim();
      // A blank cell means "the fee app has nothing to say", never "erase".
      if (!cell) continue;
      if (property === "busRoute" && NOT_A_ROUTE.has(cell.toLowerCase())) continue;
      if (property === "dob" && /^\d+(\.\d+)?$/.test(cell)) {
        cell = excelSerialToDate(Number(cell)) ?? cell;
      }

      const { value, warning } = NORMALISE.get(property)!(cell);
      if (warning) warnings.push(`row ${rowNumber}: ${warning}`);
      if (value === null) continue;

      const dbName = DB_NAME_BY_PROPERTY.get(property);
      if (dbName) values[dbName] = value;
    }

    const srNo = values.sr_no;
    const name = values.name;
    const classLabel = values.class_label;

    // Matching is by SR number, so a row without one cannot be matched and a
    // duplicate would be matched twice. Both are source-file problems.
    if (!srNo) {
      problems.push(`row ${rowNumber}: no SR number — skipped`);
      return;
    }
    if (seenSr.has(srNo)) {
      problems.push(`row ${rowNumber}: SR ${srNo} appears twice in the sheet — skipped`);
      return;
    }
    if (!name || !classLabel) {
      problems.push(`row ${rowNumber}: SR ${srNo} has no ${!name ? "name" : "usable class"} — skipped`);
      return;
    }

    seenSr.add(srNo);
    rows.push({ srNo, name, classLabel, values, warnings });
  });

  return { rows, problems };
}

/**
 * Delete students who have left, and everything that points at them.
 *
 * `submissions` and `change_log` are append-only BY GRANT — app_rw has no
 * DELETE on either, which is the whole point of drizzle/sql/grants.sql. So this
 * runs on the owner connection, the same one migrations use, and it is the only
 * place in the codebase that does. If that reads as a loophole, it is: deleting
 * a student who answered a request destroys a teacher's answer, and the fact
 * that it takes the migration credential to do it is the guard rail.
 *
 * `value_sources` is ON DELETE CASCADE and needs no statement.
 */
async function removeStudents(ids: string[], bundlePath: string) {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_UNPOOLED is not set. Removing a student needs the owner role, because submissions and change_log are append-only for the app role.",
    );
  }
  const sql = neon(connectionString);

  // A dump first. Neon's history retention on this project is six hours, which
  // is not long enough to notice this was the wrong list.
  const archive = join(
    dirname(bundlePath),
    "archive",
    `removed-students-${stamp()}.json`,
  );
  const dump = {
    removedAt: new Date().toISOString(),
    bundle: bundlePath,
    students: await sql`select * from students where id = any(${ids})`,
    valueSources: await sql`select * from value_sources where student_id = any(${ids})`,
    requestStudents: await sql`select * from request_students where student_id = any(${ids})`,
    studentRecords: await sql`select * from student_records where student_id = any(${ids})`,
    submissions: await sql`select * from submissions where student_id = any(${ids})`,
    changeLog: await sql`select * from change_log where submission_id in (select id from submissions where student_id = any(${ids}))`,
  };
  await mkdir(dirname(archive), { recursive: true });
  await writeFile(archive, JSON.stringify(dump, null, 2), "utf8");
  console.log(`\narchived ${dump.students.length} students and their history to ${archive}`);

  // Children before parents.
  const changeLog = await sql`delete from change_log where submission_id in (select id from submissions where student_id = any(${ids})) returning id`;
  const submissions = await sql`delete from submissions where student_id = any(${ids}) returning id`;
  const requestStudents = await sql`delete from request_students where student_id = any(${ids}) returning student_id`;
  const studentRecords = await sql`delete from student_records where student_id = any(${ids}) returning id`;
  const students = await sql`delete from students where id = any(${ids}) returning id`;

  return {
    changeLog: changeLog.length,
    submissions: submissions.length,
    requestStudents: requestStudents.length,
    studentRecords: studentRecords.length,
    students: students.length,
    archive,
  };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

main().then(() => process.exit(0));
