import "../drizzle/env";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { CLASS_LABELS, isClassLabel } from "../src/lib/classes";

/**
 * One-off: move teacher class assignments onto the canonical labels.
 *
 * Teachers were entered before the real export arrived, under the convention
 * this codebase assumed at the time — '6', '11 Sci', '12 Com'. The fee app is
 * the source of truth and uses 'Class 6', '11 Science', '12 Commerce', so every
 * one of those assignments now matches nothing: the class would still work, but
 * its own teacher would never be offered as its owner in the request builder,
 * and nobody would be told why.
 *
 * Idempotent. Run it, run it again, it does nothing the second time:
 *
 *     npx tsx scripts/fix-teacher-classes.ts          # show what it would do
 *     npx tsx scripts/fix-teacher-classes.ts --apply  # do it
 *
 * Anything it cannot map confidently is listed and left alone. This script
 * guesses nothing.
 */
const RENAMES = new Map<string, string>([
  ...Array.from({ length: 10 }, (_, i): [string, string] => [
    String(i + 1),
    `Class ${i + 1}`,
  ]),
  ["Nur", "Nursery"],
  ["Nursary", "Nursery"],
  ["11 Sci", "11 Science"],
  ["11 Com", "11 Commerce"],
  ["12 Sci", "12 Science"],
  ["12 Com", "12 Commerce"],
]);

async function main() {
  const apply = process.argv.includes("--apply");
  const teachers = await db.select().from(schema.teachers);

  const unmapped = new Set<string>();
  let changed = 0;

  for (const teacher of teachers) {
    const next = teacher.classes.map((label) => {
      if (isClassLabel(label)) return label;
      const renamed = RENAMES.get(label);
      if (renamed) return renamed;
      unmapped.add(label);
      return label;
    });

    if (next.join("|") === teacher.classes.join("|")) continue;

    console.log(
      `${teacher.id}: [${teacher.classes.join(", ")}] -> [${next.join(", ")}]`,
    );
    changed += 1;

    if (apply) {
      await db
        .update(schema.teachers)
        .set({ classes: next })
        .where(eq(schema.teachers.id, teacher.id));
    }
  }

  console.log(
    apply
      ? `\nupdated ${changed} teachers`
      : `\n${changed} teachers would change — re-run with --apply`,
  );

  if (unmapped.size > 0) {
    console.log(
      `\nLeft alone because there is no obvious mapping: ${[...unmapped].join(", ")}`,
    );
    console.log(`Valid labels are: ${CLASS_LABELS.join(", ")}`);
  }
}

main().then(() => process.exit(0));
