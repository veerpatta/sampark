import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { normalisePhone, isCompletePhone } from "./phone";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./whatsapp-templates";

/**
 * The office as a recipient, and the master link that belongs to it.
 *
 * WHY THE OFFICE IS A ROW IN `teachers`. A master link reaches every group in a
 * round, so its recipient is not a teacher. It could not be a NULL teacher_id:
 * resolveToken INNER JOINs that table (lib/auth/token.ts), so a link with no
 * recipient would 404 on its own URL. A row is also the only place the number
 * can live — this repository is public, so the office's phone number cannot be
 * a constant in it, and an environment variable would need a redeploy to
 * change. In the database it is editable from Settings in seconds.
 *
 * WHY EVERY PICKER CALLS listPickableTeachers() RATHER THAN WRITING THE FILTER.
 * Six screens select active teachers, and `classes = '{}'` only stops the
 * fan-out CHOOSING the office — the override dropdowns offer every active
 * teacher, so one mistap could make "Office" the class teacher of Class 8 and
 * send that class's link to the wrong phone. Six call sites each remembering a
 * filter is the failure listRequests describes about archived rows: a filter
 * any of them could forget is a filter one of them eventually will.
 */

/**
 * There is exactly one office row, so its id is fixed rather than generated.
 *
 * A known id is what lets ensureOfficeRecipient be an upsert instead of a
 * search, and what keeps a second office row from being creatable at all.
 */
export const OFFICE_TEACHER_ID = "office";

/** The audience_kind a master link carries. Plain text; see drizzle/schema.ts. */
export const MASTER_AUDIENCE_KIND = "master";

/**
 * The audience_label every master link carries, in every round.
 *
 * IT IS A CONSTANT, AND THAT IS LOAD-BEARING. requests_batch_scope_idx is
 * unique on (batch_id, audience_kind, audience_label), so a fixed label is what
 * makes "one master link per round" a database guarantee rather than a check
 * somebody remembers to write. A double-tapped Resume hits the index.
 */
export const OFFICE_AUDIENCE_LABEL = "All classes";

export type TeacherRow = typeof schema.teachers.$inferSelect;

/** True for the round's own link — the one the office holds. */
export function isMasterRequest(row: { audienceKind: string }): boolean {
  return row.audienceKind === MASTER_AUDIENCE_KIND;
}

/**
 * Every teacher a screen may offer: active, and not the office.
 *
 * The one query the six pickers share. Returns whole rows because that is what
 * most of them already had; a caller wanting two columns can map.
 */
export async function listPickableTeachers(): Promise<TeacherRow[]> {
  return db
    .select()
    .from(schema.teachers)
    .where(and(eq(schema.teachers.active, true), eq(schema.teachers.isOffice, false)))
    .orderBy(asc(schema.teachers.name));
}

/** The office row, or null when nobody has set a number yet. */
export async function getOfficeRecipient(): Promise<TeacherRow | null> {
  const [row] = await db
    .select()
    .from(schema.teachers)
    .where(eq(schema.teachers.isOffice, true))
    .limit(1);
  return row ?? null;
}

export class OfficeValidationError extends Error {}

/**
 * Create the office row, or change its number.
 *
 * `active` is forced true: an inactive office row would leave every round
 * minting a master link nobody can be sent, which is a silent failure rather
 * than a refusal. Deactivating the office is done by clearing its page token,
 * which is what actually revokes anything.
 */
export async function ensureOfficeRecipient(input: {
  phone: string;
  name?: string;
  language?: string;
}): Promise<TeacherRow> {
  const phone = normalisePhone(input.phone);
  if (!isCompletePhone(phone)) {
    throw new OfficeValidationError("A phone number is 10 digits, with no country code.");
  }

  const name = (input.name ?? "").trim() || "Office";
  const language: Language = isLanguage(input.language) ? input.language : DEFAULT_LANGUAGE;

  const [row] = await db
    .insert(schema.teachers)
    .values({
      id: OFFICE_TEACHER_ID,
      name,
      phone,
      isOffice: true,
      active: true,
      language,
    })
    .onConflictDoUpdate({
      target: schema.teachers.id,
      set: { name, phone, language, isOffice: true, active: true },
    })
    .returning();

  if (!row) throw new Error("Office upsert returned nothing.");
  return row;
}
