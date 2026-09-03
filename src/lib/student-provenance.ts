import { eq } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * Where each value on a child's record came from, said in one line.
 *
 * The console has always KNOWN this — value_sources is what precedence reads
 * to decide whether an import may overwrite a field — and never SHOWN it. So
 * the office stood at /students/[id] looking at a phone number with no way to
 * tell whether it was the PSP file from March, a teacher's correction approved
 * last week, or something a colleague typed yesterday. Those three deserve
 * different levels of trust, and the sentence under the box now says which.
 *
 * Two reads, joined here rather than in SQL:
 *
 *   value_sources  — which SOURCE owns the field, and when it last wrote it.
 *                    Keyed by DATABASE column name ('father_name').
 *   change_log     — which PERSON last decided or typed it. Keyed by registry
 *                    key, which is the same string for every column except the
 *                    photograph ('photo' vs 'photo_path') — dbNameForLogKey is
 *                    the inverse of student-edit.ts's logKeyFor.
 *
 * The page already loads the change history for its timeline, so it is passed
 * in rather than read twice.
 */

export type LastChange = { by: string; at: Date; decision: string };

export type Provenance = {
  /** sources.key — psp | fees | election | teacher | office — or null when unrecorded. */
  source: string | null;
  sourceLabel: string | null;
  sourceUpdatedAt: Date | null;
  /** The most recent change_log row that actually changed the value. */
  lastChange: LastChange | null;
};

export type HistoryRow = {
  fieldKey: string;
  decidedByName: string;
  decidedAt: Date;
  decision: string;
};

/** The inverse of logKeyFor: a change_log field_key back to a students column. */
export function dbNameForLogKey(logKey: string): string {
  return logKey === "photo" ? "photo_path" : logKey;
}

/** Decisions that changed the record. A rejection leaves the value alone. */
const CHANGING = new Set(["approved", "edited", "created"]);

/**
 * The latest changing decision per DATABASE column. Pure, so a test can hand
 * it three rows and check which one wins.
 */
export function latestByField(history: HistoryRow[]): Map<string, LastChange> {
  const out = new Map<string, LastChange>();
  for (const row of history) {
    if (!CHANGING.has(row.decision)) continue;
    const column = dbNameForLogKey(row.fieldKey);
    const current = out.get(column);
    if (!current || row.decidedAt > current.at) {
      out.set(column, { by: row.decidedByName, at: row.decidedAt, decision: row.decision });
    }
  }
  return out;
}

export type ValueSourceRow = {
  fieldKey: string;
  sourceKey: string;
  sourceLabel: string;
  sourceUpdatedAt: Date;
};

/**
 * Which source owns each of a child's values.
 *
 * Split from the merge below so a page can run it in the SAME wave as the
 * change history rather than after it — it needs only the id from the URL.
 */
export async function loadValueSources(studentId: string): Promise<ValueSourceRow[]> {
  return db
    .select({
      fieldKey: schema.valueSources.fieldKey,
      sourceKey: schema.valueSources.sourceKey,
      sourceLabel: schema.sources.label,
      sourceUpdatedAt: schema.valueSources.sourceUpdatedAt,
    })
    .from(schema.valueSources)
    .innerJoin(schema.sources, eq(schema.sources.key, schema.valueSources.sourceKey))
    .where(eq(schema.valueSources.studentId, studentId));
}

/** The two halves put together. Pure. */
export function mergeProvenance(
  rows: ValueSourceRow[],
  history: HistoryRow[],
): Map<string, Provenance> {
  const latest = latestByField(history);
  const out = new Map<string, Provenance>();

  for (const row of rows) {
    out.set(row.fieldKey, {
      source: row.sourceKey,
      sourceLabel: row.sourceLabel,
      sourceUpdatedAt: row.sourceUpdatedAt,
      lastChange: latest.get(row.fieldKey) ?? null,
    });
  }
  for (const [column, change] of latest) {
    if (!out.has(column)) {
      out.set(column, { source: null, sourceLabel: null, sourceUpdatedAt: null, lastChange: change });
    }
  }
  return out;
}

/** Both halves, for a caller with nothing else in flight. */
export async function provenanceFor(
  studentId: string,
  history: HistoryRow[],
): Promise<Map<string, Provenance>> {
  return mergeProvenance(await loadValueSources(studentId), history);
}

/**
 * How a source reads under a box. Shorter than sources.label, which is written
 * for a settings screen ("PSP Student Data Report") rather than for a line of
 * small print that repeats twenty times down a page.
 */
const SOURCE_WORDS: Record<string, string> = {
  psp: "PSP import",
  fees: "Fee app import",
  election: "Election list",
  teacher: "Teacher correction",
  office: "Office",
};

/**
 * One sentence about where a value came from — and what KIND of fact it is.
 *
 * The kind is what lets a screen be quiet. Twenty fields that all say "PSP
 * import · 12 Mar" is twenty lines of the same sentence, and on a phone it
 * doubled the length of the student page while burying the one line that
 * matters: that a teacher corrected this number last week. So the page shows
 * `person` lines against their field and folds every `source` line into a
 * single sentence at the foot of the card.
 *
 * Pure, so the wording and the precedence between the two are testable.
 *
 * The PERSON wins over the SOURCE whenever the person's decision is the more
 * recent fact, which is the normal case: an approved correction stamps
 * `teacher` and a hand edit stamps `office`, both at the same instant as the
 * change_log row, and the name is the more useful half of that.
 */
export type ProvenanceLine =
  /** A named person decided or typed this. Worth saying against the field. */
  | { kind: "person"; text: string; source: string }
  /** It arrived in a file. Worth saying once per card. */
  | { kind: "source"; text: string; source: string }
  | null;

export function describeProvenance(
  provenance: Provenance | undefined,
  hasValue: boolean,
  formatDate: (at: Date) => string,
): ProvenanceLine {
  if (!provenance) {
    return hasValue ? { kind: "source", text: "Loaded by import", source: "an import" } : null;
  }

  const { lastChange, source, sourceUpdatedAt } = provenance;
  const personIsLatest =
    lastChange !== null &&
    (sourceUpdatedAt === null || lastChange.at.getTime() >= sourceUpdatedAt.getTime() - 1000);

  if (lastChange && personIsLatest) {
    const when = formatDate(lastChange.at);
    const text =
      lastChange.decision === "approved"
        ? `Teacher correction, approved by ${lastChange.by} · ${when}`
        : lastChange.decision === "created"
          ? `Added by ${lastChange.by} · ${when}`
          : `Set by ${lastChange.by} · ${when}`;
    return { kind: "person", text, source: source ?? "office" };
  }

  if (source) {
    const word = SOURCE_WORDS[source] ?? provenance.sourceLabel ?? source;
    return {
      kind: "source",
      text: sourceUpdatedAt ? `${word} · ${formatDate(sourceUpdatedAt)}` : word,
      source: word,
    };
  }

  return hasValue ? { kind: "source", text: "Loaded by import", source: "an import" } : null;
}

/**
 * The one sentence a card puts at its foot, naming the files the rest of its
 * values came from. Nothing when a card holds no imported value.
 */
export function describeSources(lines: ProvenanceLine[]): string | null {
  const sources = [...new Set(lines.filter((line) => line?.kind === "source").map((line) => line!.source))]
    // "an import" is already an article; the named files each take their own,
    // so two of them read "the PSP import and the Fee app import".
    .map((source) => (source === "an import" ? source : `the ${source}`));
  if (sources.length === 0) return null;
  const named =
    sources.length === 1
      ? sources[0]
      : `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`;
  return `Everything else came from ${named}.`;
}
