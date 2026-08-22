import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { Source } from "../../drizzle/schema";

/**
 * ============================================================================
 * WHO WINS, AND WHY.
 * ============================================================================
 *
 * Files keep arriving. The fee app knows which class a child is in. PSP knows
 * who the child is. The election list knows their house and nothing else. Each
 * covers some students and some fields, and each is better than the others at
 * something.
 *
 * A one-off importer per file does not survive that: the third file silently
 * overwrites what the second one got right, and nobody finds out until a parent
 * is rung on a number that was corrected in September.
 *
 * So every value carries WHERE IT CAME FROM (`value_sources`), and precedence
 * decides whether an incoming value is allowed to replace it.
 *
 * THE RULE THAT OUTRANKS THE TABLE
 * --------------------------------
 * An APPROVED TEACHER SUBMISSION beats every import, for every field, forever.
 * It is written here in code rather than as a row in `field_sources` on
 * purpose — a row can be edited, and no administrative convenience is worth the
 * day a teacher discovers her approved correction was quietly undone by someone
 * re-importing last term's export. That is the difference between this tool
 * being trusted and being abandoned.
 */

/** Where a value came from. Matches `sources.key`. */
export type SourceKey = "psp" | "fees" | "election" | "teacher" | "office";

/**
 * Sources that a human put there deliberately. These are never overwritten by
 * an import, whatever `field_sources` says.
 */
const HUMAN_SOURCES: ReadonlySet<string> = new Set(["teacher", "office"]);

export type Precedence = {
  /** field_key (a students column name) -> the source that owns it. */
  owners: Map<string, string>;
  /** source key -> rank, for fields nobody owns. */
  ranks: Map<string, number>;
};

export async function loadPrecedence(): Promise<Precedence> {
  const [owners, sources] = await Promise.all([
    db.select().from(schema.fieldSources),
    db.select().from(schema.sources),
  ]);

  return {
    owners: new Map(owners.map((row) => [row.fieldKey, row.sourceKey])),
    ranks: new Map(sources.map((row) => [row.key, row.rank])),
  };
}

/** What we currently hold about one value's origin. */
export type StoredOrigin = {
  sourceKey: string;
  sourceUpdatedAt: Date;
};

export type PrecedenceVerdict =
  | { write: true }
  | { write: false; reason: string };

/**
 * May `incoming` overwrite what `stored` holds for this field?
 *
 * Four questions, in the order that matters:
 *
 *   1. Is the stored value human-entered? Then no. Always.
 *   2. Is the incoming source the same one that wrote it? Then yes — a source
 *      is always allowed to correct itself, which is what makes re-importing a
 *      newer export work at all.
 *   3. Does a source own this field? Then only that source may write it.
 *   4. Otherwise: whoever got there first keeps it. Unowned fields are unowned
 *      because nobody has decided yet, and "first writer wins" is the option
 *      that loses the least while they make up their mind.
 */
export function mayWrite(
  fieldKey: string,
  incoming: string,
  stored: StoredOrigin | undefined,
  precedence: Precedence,
): PrecedenceVerdict {
  // Nothing there yet — anyone may fill a blank.
  if (!stored) return { write: true };

  if (HUMAN_SOURCES.has(stored.sourceKey)) {
    return {
      write: false,
      reason:
        stored.sourceKey === "teacher"
          ? "a teacher's correction was approved for this field"
          : "the office set this by hand",
    };
  }

  if (stored.sourceKey === incoming) return { write: true };

  const owner = precedence.owners.get(fieldKey);
  if (owner) {
    if (owner === incoming) return { write: true };
    return {
      write: false,
      reason: `${owner} is authoritative for ${fieldKey}`,
    };
  }

  // Unowned. First writer keeps it, unless the incoming source outranks by a
  // clear margin — ranks exist so a future "office spreadsheet" source can be
  // slotted above a scraped one without inventing a field rule for every column.
  const incomingRank = precedence.ranks.get(incoming) ?? 0;
  const storedRank = precedence.ranks.get(stored.sourceKey) ?? 0;
  if (incomingRank > storedRank) return { write: true };

  return {
    write: false,
    reason: `${stored.sourceKey} already set ${fieldKey} and nothing outranks it`,
  };
}

/* ------------------------------------------------------------------ reading */

export type OriginMap = Map<string, StoredOrigin>;

const originKey = (studentId: string, fieldKey: string) =>
  `${studentId}|${fieldKey}`;

/** Provenance for a set of students, keyed `${studentId}|${fieldKey}`. */
export async function loadOrigins(studentIds: string[]): Promise<OriginMap> {
  const out: OriginMap = new Map();
  if (studentIds.length === 0) return out;

  for (let i = 0; i < studentIds.length; i += 200) {
    const rows = await db
      .select()
      .from(schema.valueSources)
      .where(inArray(schema.valueSources.studentId, studentIds.slice(i, i + 200)));

    for (const row of rows) {
      out.set(originKey(row.studentId, row.fieldKey), {
        sourceKey: row.sourceKey,
        sourceUpdatedAt: row.sourceUpdatedAt,
      });
    }
  }

  return out;
}

export function originOf(
  origins: OriginMap,
  studentId: string,
  fieldKey: string,
): StoredOrigin | undefined {
  return origins.get(originKey(studentId, fieldKey));
}

/* ------------------------------------------------------------------ writing */

export type OriginWrite = {
  studentId: string;
  fieldKey: string;
  sourceKey: string;
};

/**
 * Stamp provenance for values that were just written.
 *
 * Always paired with the write itself. A value whose origin was not recorded is
 * indistinguishable from one nobody has claimed, and the next import would
 * happily overwrite it.
 */
export async function recordOrigins(writes: OriginWrite[]): Promise<void> {
  if (writes.length === 0) return;

  // Postgres refuses an ON CONFLICT DO UPDATE that would touch the same row
  // twice in one statement, so collapse repeats to the last one. A caller that
  // genuinely has two competing values for one field should have refused them
  // before getting here — this is a guard, not a merge strategy.
  const unique = new Map<string, OriginWrite>();
  for (const write of writes) {
    unique.set(originKey(write.studentId, write.fieldKey), write);
  }
  writes = [...unique.values()];

  const now = new Date();
  for (let i = 0; i < writes.length; i += 200) {
    await db
      .insert(schema.valueSources)
      .values(
        writes.slice(i, i + 200).map((row) => ({ ...row, sourceUpdatedAt: now })),
      )
      .onConflictDoUpdate({
        target: [schema.valueSources.studentId, schema.valueSources.fieldKey],
        set: {
          sourceKey: sql`excluded."source_key"`,
          sourceUpdatedAt: now,
        },
      });
  }
}

/**
 * An approved teacher submission claims the field permanently. Called from the
 * review transaction, so approval and provenance land together — if the stamp
 * were a separate step that could fail, an approved correction would be
 * overwritable by the next import, which is the one outcome this whole module
 * exists to prevent.
 */
export function teacherOrigin(studentId: string, fieldKey: string): OriginWrite {
  return { studentId, fieldKey, sourceKey: "teacher" };
}

/**
 * The office typed this into /students/[id] by hand.
 *
 * `office` was seeded as a source from the beginning (drizzle/seed/sources.ts)
 * and named in HUMAN_SOURCES above, but nothing wrote it until the student page
 * became editable — mayWrite's "the office set this by hand" branch was
 * unreachable. This is the function that reaches it.
 *
 * `fieldKey` is a DATABASE COLUMN NAME — 'phone', 'photo_path' — because that
 * is what value_sources holds and what mayWrite looks up in `field_sources`.
 * Passing a field registry key here would stamp provenance under a name no
 * import ever checks, and the next PSP run would sail straight over the edit.
 */
export function officeOrigin(studentId: string, fieldKey: string): OriginWrite {
  return { studentId, fieldKey, sourceKey: "office" };
}

/* --------------------------------------------------------------- reporting */

export type SourceRow = Source;

export async function listSources(): Promise<Source[]> {
  return db.select().from(schema.sources).orderBy(schema.sources.rank);
}

/**
 * The sources a FILE may claim to be.
 *
 * `kind` is the filter, and it is doing real work. `teacher` is collected
 * through the review queue and `office` is typed by hand on a student page —
 * an upload declaring itself either of those would let a spreadsheet inherit
 * the one precedence rank that no import is ever allowed to beat, which is
 * exactly the protection HUMAN_SOURCES exists to provide.
 */
export async function listImportSources(): Promise<
  { key: string; label: string }[]
> {
  return db
    .select({ key: schema.sources.key, label: schema.sources.label })
    .from(schema.sources)
    .where(and(eq(schema.sources.kind, "import"), eq(schema.sources.active, true)))
    .orderBy(schema.sources.rank);
}

/** Which source owns a field right now — for the admin settings screen. */
export async function ownerOf(fieldKey: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(schema.fieldSources)
    .where(eq(schema.fieldSources.fieldKey, fieldKey))
    .limit(1);
  return row?.sourceKey ?? null;
}
