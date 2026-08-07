import "../drizzle/env";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { db, schema } from "../src/lib/db";
import {
  planTimetableImport,
  type TimetableGrid,
} from "../src/lib/timetable-import";
import { subjectByKey } from "../src/lib/subjects";

/**
 * Import subject assignments from the school's timetable.
 *
 *   npm run subjects:import -- "D:/github projects/timetable2025/scripts/data.js"
 *   npm run subjects:import -- "<path>" --apply
 *   npm run subjects:import -- "<path>" --apply --include-suggested
 *
 * A BOOTSTRAP, run once. The timetable will drift, and the fix for that is
 * Settings → Subjects in the browser — a script only a developer can run means
 * the second drift never gets imported at all.
 *
 * Dry by default, and it prints what it would do. `--apply` writes only the
 * exact-match assignments; the near misses need `--include-suggested` on top,
 * because "Prateek" resolving to "Pratik Jain" is a judgement about two people
 * and a person should make it once, with the list in front of them.
 *
 * The path is an argument rather than a constant: the timetable is a separate
 * repo on this machine and nothing about this one should assume where it sits.
 * The same trade drizzle/seed/teachers.ts already makes, for the same reason.
 */

const args = process.argv.slice(2);
const dataPath = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const includeSuggested = args.includes("--include-suggested");

if (!dataPath) {
  console.error(
    "Usage: npm run subjects:import -- <path-to-timetable/scripts/data.js> [--apply] [--include-suggested]",
  );
  process.exit(1);
}

async function main() {
  /**
   * The timetable ships as a UMD module whose `load()` returns the parsed grid.
   * Requiring it beats re-implementing its parser: the cell grammar
   * ("Subject (A / B)", "Free") lives there and would drift here.
   */
  const require = createRequire(import.meta.url);
  const loaded = require(resolve(dataPath!)) as {
    load: () => { timetable: TimetableGrid };
  };
  if (typeof loaded?.load !== "function") {
    throw new Error(`${dataPath} does not export load() — is that the timetable's data.js?`);
  }
  const { timetable } = loaded.load();

  const teachers = await db
    .select({ id: schema.teachers.id, name: schema.teachers.name })
    .from(schema.teachers);

  const plan = planTimetableImport(timetable, teachers);

  const line = (a: { teacherName: string; subjectKey: string; classLabel: string }) =>
    `  ${a.teacherName.padEnd(24)} ${(subjectByKey(a.subjectKey)?.en ?? a.subjectKey).padEnd(20)} ${a.classLabel}`;

  console.log(`\nMATCHED EXACTLY — ${plan.confirmed.length} assignments`);
  for (const a of plan.confirmed) console.log(line(a));

  if (plan.suggested.length > 0) {
    console.log(`\nNEEDS A DECISION — ${plan.suggested.length} assignments`);
    console.log("  the timetable's name is close but not identical:");
    for (const a of plan.suggested) {
      console.log(`${line(a)}   ← "${a.timetableName}" (distance ${a.distance})`);
    }
  }

  if (plan.unmatchedTeachers.length > 0) {
    console.log(`\nNO SUCH TEACHER — ${plan.unmatchedTeachers.length} names`);
    for (const t of plan.unmatchedTeachers) {
      console.log(
        `  ${t.timetableName.padEnd(24)} ${t.subjects.join(", ")}  (${t.classLabels.join(", ")})`,
      );
    }
  }
  if (plan.unknownClasses.length > 0) {
    console.log(`\nUNKNOWN CLASSES: ${plan.unknownClasses.join(", ")}`);
  }
  if (plan.skippedSubjects.length > 0) {
    console.log(
      `\nSUBJECTS WITH NO MARKS FIELD: ${plan.skippedSubjects.join(", ")}` +
        "\n  (add them to SUBJECTS in src/lib/subjects.ts, or to NON_ACADEMIC)",
    );
  }

  const writing = includeSuggested
    ? [...plan.confirmed, ...plan.suggested]
    : plan.confirmed;

  if (!apply) {
    console.log(
      `\nDRY RUN. Nothing was written.` +
        `\n  --apply                     writes the ${plan.confirmed.length} exact matches` +
        `\n  --apply --include-suggested writes ${writing.length === plan.confirmed.length ? plan.confirmed.length + plan.suggested.length : writing.length} (the near misses too)`,
    );
    return;
  }

  if (writing.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  // onConflictDoNothing, not DoUpdate: a row already here was either put here by
  // a previous run of this same import, or typed by the office in Settings. The
  // second must survive — re-importing a drifted timetable should never be the
  // reason a hand correction disappears.
  await db
    .insert(schema.teacherSubjects)
    .values(
      writing.map((a) => ({
        teacherId: a.teacherId,
        subjectKey: a.subjectKey,
        classLabel: a.classLabel,
        assignedBy: "timetable",
      })),
    )
    .onConflictDoNothing();

  const [{ n }] = await db
    .select({ n: schema.teacherSubjects.teacherId })
    .from(schema.teacherSubjects)
    .then((rows) => [{ n: rows.length }]);

  console.log(`\nWrote ${writing.length}. ${n} assignments on record.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
