import "../env";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../schema";
import { FIELD_DEFS } from "./field_defs";
import { TEACHERS } from "./teachers";

/**
 * Idempotent seed. Safe to re-run: every insert is an upsert keyed on the
 * primary key, so re-seeding updates labels and validation rules rather than
 * failing or duplicating.
 *
 * Run with:  npm run db:seed
 *
 * Seeds the field registry and the teacher list only. Students come from a real
 * PSP export through /students/import — never from a seed file.
 */
async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const db = drizzle(neon(url), { schema });

  if (FIELD_DEFS.length > 0) {
    await db
      .insert(schema.fieldDefs)
      .values(FIELD_DEFS)
      .onConflictDoUpdate({
        target: schema.fieldDefs.key,
        set: {
          labelEn: sqlExcluded("label_en"),
          labelHi: sqlExcluded("label_hi"),
          mode: sqlExcluded("mode"),
          inputType: sqlExcluded("input_type"),
          targetColumn: sqlExcluded("target_column"),
          recordKind: sqlExcluded("record_kind"),
          maxValue: sqlExcluded("max_value"),
          exactLen: sqlExcluded("exact_len"),
          pattern: sqlExcluded("pattern"),
          options: sqlExcluded("options"),
          sortOrder: sqlExcluded("sort_order"),
          active: sqlExcluded("active"),
        },
      });
    console.log(`seeded ${FIELD_DEFS.length} field definitions`);
  }

  if (TEACHERS.length > 0) {
    await db
      .insert(schema.teachers)
      .values(TEACHERS)
      .onConflictDoUpdate({
        target: schema.teachers.id,
        set: {
          name: sqlExcluded("name"),
          phone: sqlExcluded("phone"),
          classes: sqlExcluded("classes"),
          active: sqlExcluded("active"),
        },
      });
    console.log(`seeded ${TEACHERS.length} teachers`);
  } else {
    console.log("no teachers to seed — fill drizzle/seed/teachers.ts");
  }
}

// Small helper so the upsert SET clauses stay readable.
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
