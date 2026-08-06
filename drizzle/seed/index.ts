import "../env";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../schema";
import { FIELD_DEFS } from "./field_defs";
import { TEACHERS } from "./teachers";
import { FIELD_SOURCES, SOURCES } from "./sources";

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

  // Sources first: field_sources references them, and value_sources will too.
  await db
    .insert(schema.sources)
    .values(SOURCES)
    .onConflictDoUpdate({
      target: schema.sources.key,
      set: {
        label: sqlExcluded("label"),
        kind: sqlExcluded("kind"),
        rank: sqlExcluded("rank"),
        active: sqlExcluded("active"),
      },
    });
  console.log(`seeded ${SOURCES.length} sources`);

  await db
    .insert(schema.fieldSources)
    .values(FIELD_SOURCES)
    .onConflictDoUpdate({
      target: schema.fieldSources.fieldKey,
      set: { sourceKey: sqlExcluded("source_key") },
    });
  console.log(`seeded ${FIELD_SOURCES.length} field ownership rules`);

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

// No process.exit(0) on success. It used to be here, and on Node 24 for Windows
// it tore the event loop down while the Neon HTTP socket was still closing:
// libuv asserts (`!(handle->flags & UV_HANDLE_CLOSING)`) and the command exits
// 3221226505 having seeded everything correctly. A seed that reports failure
// after succeeding is one people re-run, and re-running is how a real mistake
// gets made. Nothing here holds the loop open, so falling off the end exits 0.
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
