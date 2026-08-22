import { eq, getTableColumns, sql } from "drizzle-orm";
import { CLASS_LABELS } from "./classes";
import { db, schema } from "./db";
import { HOUSES } from "./houses";
import { officeOrigin } from "./precedence";
import { BUS_ROUTES } from "./routes";
import { IMPORT_COLUMNS, type ColumnSpec, type StudentColumn } from "./students-import";
import type { Student } from "../../drizzle/schema";

/**
 * The office correcting one child's record by hand.
 *
 * WHY THIS EXISTS AT ALL. /students/[id] was read-only on the stated grounds
 * that a change typed there would carry "no proposal, no reviewer and no audit
 * trail". Two of those three are supplied by the caller — the gate is
 * canApproveIntoMaster, so the person typing is the same person who would have
 * approved it, and every change lands in `change_log` with their name on it.
 * The third is not missing so much as inapplicable: a proposal exists to keep an
 * unreviewed TEACHER out of master, and there is no teacher here.
 *
 * The provenance stamp is what makes it safe. Every field written through this
 * module is claimed for `office` in `value_sources`, which lib/precedence.ts
 * lists in HUMAN_SOURCES — so no PSP or fee-app import can ever quietly undo it.
 * That source key was seeded from the start and had no writer until now.
 *
 * THIS MODULE IS SERVER-ONLY. It reaches IMPORT_COLUMNS, and that file imports
 * `node:crypto`. A client component may import the TYPES below — those are
 * erased at build time — but importing a value from here would drag a crypto
 * polyfill into the admin bundle. See the same warning at the top of photos.ts.
 */

/* --------------------------------------------------------------- the fields */

/**
 * Columns the office may edit, derived from the importer's list rather than
 * written out again — a column added to one screen must not silently go missing
 * from the other.
 *
 * `id` is the only exclusion. It is the primary key, four tables carry a
 * foreign key to it, and every photo blob pathname has it as a path segment, so
 * changing it is a re-key across the database and the blob store rather than a
 * field edit. The TMP- badge on the student page stays unresolved until someone
 * builds that properly.
 */
export const EDITABLE_COLUMNS: ColumnSpec[] = IMPORT_COLUMNS.filter(
  (spec) => spec.column !== "id",
);

/**
 * The shape of the underlying column, DERIVED FROM THE SCHEMA rather than
 * listed here.
 *
 * Two facts matter and neither is visible in IMPORT_COLUMNS:
 *
 *   NOT NULL. `name`, `class_label` and `status` cannot be nulled. An importer
 *   never discovers this because a blank cell means "no change" to it and it
 *   simply skips the column. A form CAN discover it — somebody selects the name
 *   and presses delete — and without a check the null travels all the way to
 *   Postgres and comes back as a constraint violation, which reaches the office
 *   as a crashed page rather than as "Name cannot be empty."
 *
 *   INTEGER. `roll_no` is the one `integer()` among these; every normalise()
 *   returns a string, and Drizzle's insert type for that column is
 *   `number | null`. `.set({ rollNo: "7" })` does not typecheck and, cast away,
 *   would hand Postgres a string.
 *
 * Read from getTableColumns for the reason student-columns.ts:20-21 gives: a
 * hand-written copy goes stale the first time somebody adds a column, and the
 * failure is silent.
 */
const STUDENT_COLUMNS = getTableColumns(schema.students);

function isNotNull(column: StudentColumn): boolean {
  return STUDENT_COLUMNS[column as keyof typeof STUDENT_COLUMNS]?.notNull ?? false;
}

function isNumeric(column: StudentColumn): boolean {
  return STUDENT_COLUMNS[column as keyof typeof STUDENT_COLUMNS]?.dataType === "number";
}

/**
 * How one field is drawn, and what it may hold.
 *
 * Plain data with no functions on it, because the page (a server component)
 * builds these and hands them to a client component as props.
 */
export type EditField = {
  /** The Drizzle property name. Also the form input's `name`. */
  column: StudentColumn;
  label: string;
  control: "text" | "tel" | "number" | "date" | "select";
  /** Present only for `select`. */
  options?: string[];
  /** What the record currently holds, for the input's defaultValue. */
  value: string;
};

/**
 * Which columns are a closed set, and WHO IS RIGHT ABOUT WHAT THAT SET IS.
 *
 * This is the subtle one. IMPORT_COLUMNS normalises `category` against
 * GEN/OBC/SC/ST/EWS, and that list is simply wrong about this school: PSP writes
 * GENERAL not GEN, 45 children are SBC which is absent from it, and nobody is
 * EWS. The field registry has the right five. lib/students.ts says the same
 * thing at listFacets and concludes that what is in the column is the truth.
 *
 * So a category dropdown built from the importer would have been unable to
 * express the value most of the school holds, and `oneOf` would have rejected it
 * as invalid on the way back in. Closed sets come from the module that is
 * actually authoritative for each one, and `category` and `gender` come from the
 * field registry, which is a database read — hence `optionsFor` taking them in.
 *
 * Fixing the importer's list is a separate change with its own blast radius over
 * tests/students-import.test.ts. It is not folded in here.
 */
const STATUSES = ["active", "left", "tc_issued"];

/** Columns whose control is not a plain text box. */
const CONTROLS: Partial<Record<StudentColumn, EditField["control"]>> = {
  classLabel: "select",
  house: "select",
  busRoute: "select",
  status: "select",
  gender: "select",
  category: "select",
  rollNo: "number",
  dob: "date",
  phone: "tel",
  altPhone: "tel",
  aadhaar: "tel",
  janAadhaar: "tel",
};

/**
 * Build the form's field list.
 *
 * `registryOptions` maps a students column to the options the field registry
 * holds for it — pass what `field_defs` says for `gender` and `category`. When
 * the registry has nothing to say, the select degrades to a text box rather
 * than to an empty dropdown, because a dropdown with no options is a field
 * nobody can fill.
 */
export function editFields(
  student: Student,
  registryOptions: Map<string, string[]>,
): EditField[] {
  return EDITABLE_COLUMNS.map((spec) => {
    const control = CONTROLS[spec.column] ?? "text";
    const value = currentValue(student, spec.column);
    const options =
      control === "select"
        ? withCurrent(optionsFor(spec.column, registryOptions), value)
        : undefined;

    return {
      column: spec.column,
      label: spec.label,
      // A select with nothing to choose from is worse than a text box.
      control: control === "select" && !options?.length ? "text" : control,
      options: options?.length ? options : undefined,
      value,
    };
  });
}

/**
 * WHATEVER THE CHILD ACTUALLY IS, IT IS ONE OF THE CHOICES.
 *
 * This is not a nicety. A <select> whose defaultValue matches no <option>
 * renders as the first option instead — the blank one — so the field reads as
 * unset. Press Save without touching it and the server sees "" where the record
 * said something, decides the box was deliberately cleared, and erases it. One
 * visit to the page would quietly null a column on every student whose value
 * was not spelled the way the registry spells it.
 *
 * And that is the common case, not the edge case. The registry says gender is
 * Male/Female and category is GENERAL/OBC/SC/SBC/ST; the database holds "M",
 * "F" and "General". lib/students.ts already refuses to build its filter chips
 * from any of the canonical lists for exactly this reason and concludes that
 * what is in the column is the truth. The same conclusion applies here: the
 * canonical list is what the office SHOULD pick from, and the stored value is
 * what this child IS, and a dropdown has to be able to say both.
 *
 * The odd value goes last, so the canonical choices still lead — but it is the
 * selected one, so it is what the closed control shows.
 */
function withCurrent(options: string[] | undefined, value: string): string[] | undefined {
  if (!options || value === "") return options;
  return options.includes(value) ? options : [...options, value];
}

function optionsFor(
  column: StudentColumn,
  registryOptions: Map<string, string[]>,
): string[] | undefined {
  switch (column) {
    case "classLabel":
      return [...CLASS_LABELS];
    case "house":
      return HOUSES.map((house) => house.name);
    case "busRoute":
      return [...BUS_ROUTES];
    case "status":
      return STATUSES;
    // The registry, not the importer. See the note above.
    case "gender":
    case "category":
      return registryOptions.get(dbNameFor(column));
    default:
      return undefined;
  }
}

/** What the record holds, as a string a form input can carry. */
function currentValue(student: Student, column: StudentColumn): string {
  const value = student[column as keyof Student];
  if (value === null || value === undefined) return "";
  // `dob` is a date column and comes back as a Date. <input type="date"> wants
  // YYYY-MM-DD and silently renders nothing for anything else.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * What the field registry says the closed sets are, keyed by students column.
 *
 * A database read, because `field_defs.options` is data the owner edits in
 * /settings/fields rather than a constant. That is deliberate: the school's
 * categories changed once already (GEN became GENERAL, SBC appeared), and a
 * list that can only be corrected by a deploy is a list that stays wrong.
 */
export async function registryOptions(): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      targetColumn: schema.fieldDefs.targetColumn,
      options: schema.fieldDefs.options,
    })
    .from(schema.fieldDefs);

  const out = new Map<string, string[]>();
  for (const row of rows) {
    // `options` is jsonb, so its static type is unknown-ish and its runtime
    // shape is whatever /settings/fields last wrote. Check it here rather than
    // casting: a malformed row should cost this one dropdown, not the page.
    if (!row.targetColumn || !Array.isArray(row.options)) continue;
    const options = row.options.filter(
      (option): option is string => typeof option === "string",
    );
    if (options.length > 0) out.set(row.targetColumn, options);
  }
  return out;
}

/* ------------------------------------------------------------------ naming */

/**
 * Drizzle property name -> database column name. `fatherName` -> `father_name`.
 *
 * value_sources and field_defs.target_column both speak database names; a row
 * that comes back from Drizzle is keyed by the property name. Lifted out of the
 * student detail page so the page and the action cannot drift apart on it. See
 * the longer warning at the top of student-columns.ts, which is about the same
 * two-names problem going wrong in the other direction.
 */
export function dbNameFor(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * What to write into `change_log.field_key`.
 *
 * Both audit renderers left-join `field_defs` on this to get a human label, so
 * it wants to be a REGISTRY key where one exists. For every collectable field
 * the registry key and the database column name happen to be the same
 * string — except the photograph, whose key is `photo` and whose target column
 * is `photo_path`. Columns the registry does not cover at all (name, class,
 * roll, address, SR number...) fall through as their database name and render
 * as themselves, which both renderers already handle with `?? entry.fieldKey`.
 */
export function logKeyFor(dbName: string): string {
  return dbName === "photo_path" ? "photo" : dbName;
}

/* ------------------------------------------------------------------ editing */

export type FieldChange = {
  column: StudentColumn;
  /** Database column name — what value_sources keys on. */
  dbName: string;
  /** Field registry key where one exists — what change_log keys on. */
  logKey: string;
  /** For change_log, whose from_value/to_value are both `text`. */
  from: string | null;
  toValue: string | null;
  /**
   * For the students UPDATE, typed as the column really is. Separate from
   * `toValue` because roll_no is an integer and change_log is text — one field
   * carrying both would have to be cast at one end or the other, and the cast
   * is exactly where a "7" reaches an integer column.
   */
  to: string | number | null;
};

export type EditOutcome = {
  changes: FieldChange[];
  /** Keyed by column, so each message renders against its own input. */
  errors: Record<string, string>;
};

/**
 * Work out what actually changed, and refuse anything that did not normalise.
 *
 * Pure — no database, no session — so the rules below are testable on their own.
 *
 * BLANK MEANS ERASE HERE, AND THAT IS NOT A CONTRADICTION.
 * ------------------------------------------------------
 * The importer's second rule is that a blank cell means "no change", never
 * "erase", and it is right: an empty column in a spreadsheet is nearly always a
 * column the file does not carry, and reading it as an instruction would empty
 * the school's phone book on the first partial export.
 *
 * A pre-filled form is the opposite situation. The box was showing 9414xxxxxx,
 * a person selected it and pressed delete, and there is no other way to read
 * that. So this compares what came back against what is on the record and treats
 * a cleared box as an explicit write of null. The two rules disagree because the
 * two situations genuinely differ, not because one of them is an oversight.
 *
 * A NORMALISE WARNING IS A HARD ERROR HERE, FOR THE SAME REASON.
 * -------------------------------------------------------------
 * normalise() answers bad input with { value: null, warning }, which the
 * importer reads as "leave this row's field alone and note it in the preview".
 * On a form that would be silent: the office types a corrected number, the old
 * one comes back, and nothing says why. So a warning becomes a refusal.
 *
 * And it refuses the WHOLE save, not the offending field. A partial write is the
 * outcome nobody can reconstruct afterwards — the change history would show
 * three of the five fields somebody believed they had just corrected.
 */
export function applyEdits(
  student: Student,
  fields: EditField[],
  read: (column: string) => string | null,
): EditOutcome {
  const changes: FieldChange[] = [];
  const errors: Record<string, string> = {};
  const specs = new Map(EDITABLE_COLUMNS.map((spec) => [spec.column, spec]));

  for (const field of fields) {
    const spec = specs.get(field.column);
    if (!spec) continue;

    const raw = read(spec.column);
    // The field was not on the form at all. Absent is not the same as cleared:
    // only a box that was rendered can have been emptied on purpose.
    if (raw === null) continue;

    const before = currentValue(student, spec.column);
    const typed = raw.trim();

    if (typed === before.trim()) continue;

    if (typed === "") {
      if (isNotNull(spec.column)) {
        errors[spec.column] = `${spec.label} cannot be empty.`;
        continue;
      }
      changes.push(change(spec.column, before, null));
      continue;
    }

    /*
     * A SELECT IS VALIDATED AGAINST THE OPTIONS IT OFFERED, not against the
     * importer's normaliser — and this is the whole reason `fields` is a
     * parameter rather than something this function derives for itself.
     *
     * The two disagree about `category`. The dropdown is built from the field
     * registry (GENERAL/OBC/SC/SBC/ST, which is what this school actually
     * holds); IMPORT_COLUMNS normalises against GEN/OBC/SC/ST/EWS, which is
     * wrong about it — see the note beside optionsFor. Left to the normaliser,
     * the form would offer GENERAL in a dropdown and then refuse it as invalid
     * on the way back, which is the most baffling failure a form can produce.
     *
     * Taking the rendered options as the truth makes that class of divergence
     * impossible rather than merely fixed: whatever a select shows is exactly
     * what it accepts.
     */
    if (field.control === "select" && field.options) {
      if (!field.options.includes(typed)) {
        errors[spec.column] = `${spec.label} must be one of: ${field.options.join(", ")}.`;
        continue;
      }
      if (typed !== before) changes.push(change(spec.column, before, typed));
      continue;
    }

    const result = spec.normalise(typed);
    if (result.warning || result.value === null) {
      errors[spec.column] = editMessage(result.warning, spec.label);
      continue;
    }

    // Normalising can land back on what is already stored — "9414 123456"
    // becoming "9414123456" when that is what the record already said. Nothing
    // changed, so nothing should be logged.
    if (result.value === before) continue;

    changes.push(change(spec.column, before, result.value));
  }

  // ALL OR NOTHING, ENFORCED HERE RATHER THAN LEFT TO THE CALLER.
  //
  // A partial write is the outcome nobody can reconstruct afterwards: the
  // change history would show three of the five fields somebody believed they
  // had just corrected, and no record of the two that were dropped. Returning
  // the valid changes alongside the errors would make that one forgotten
  // `if (errors)` away, so the changes are withheld instead of merely
  // discouraged.
  if (Object.keys(errors).length > 0) return { changes: [], errors };

  return { changes, errors };
}

function change(
  column: StudentColumn,
  before: string,
  value: string | null,
): FieldChange {
  const dbName = dbNameFor(column);
  return {
    column,
    dbName,
    logKey: logKeyFor(dbName),
    from: before || null,
    toValue: value,
    to: value !== null && isNumeric(column) ? Number(value) : value,
  };
}

/**
 * The importer's warning, said to somebody who is looking at a form.
 *
 * Five of the normalisers end with "— left unchanged", which is true of an
 * import preview and false here: this save is being refused outright, and what
 * she typed is still in the box in front of her. Telling her the field was left
 * unchanged when the whole form was rejected is the kind of small lie that
 * teaches people to stop reading error messages.
 *
 * Trimmed at this end rather than fixed in students-import.ts, because the
 * import preview still needs the honest phrase — there, the field really is
 * left unchanged and the rest of the row still lands.
 */
function editMessage(warning: string | undefined, label: string): string {
  if (!warning) return `${label} is not a value this field can hold.`;
  return warning.replace(/\s*[—-]\s*left unchanged\.?$/i, "");
}

/* ------------------------------------------------------------------ writing */

/**
 * Write an office edit: the audit row, the master record, and the provenance.
 *
 * ORDER MIRRORS decideSubmissions (lib/submissions.ts). Log first, then master,
 * then the source stamp — so a half-applied write leaves evidence rather than a
 * silent change.
 *
 * ATOMIC, AND THAT IS THE POINT. The reason is written out at
 * submissions.ts:786-795 and it is worth repeating because it is the failure
 * this whole precedence layer exists to prevent: a provenance stamp that can
 * fail on its own leaves a corrected value sitting in master looking settled
 * while still carrying its old source, and the next PSP import quietly puts the
 * wrong number back. Nobody finds out until a parent is rung on it.
 *
 * BUT `db.batch`, NOT `withTransaction`. That helper opens a WebSocket pool per
 * call and its own doc comment (lib/db.ts) says it exists for the one path that
 * has to READ a result partway through and branch on it — the approval's
 * `AND review_status = 'pending' RETURNING` guard. Nothing here branches: every
 * value was computed by applyEdits before the first statement is sent. So this
 * takes the same route recordSubmissions and applyPreview take, which sends the
 * lot as a single atomic request over the HTTP driver and, in that function's
 * words, does not pay for a capability it never uses.
 *
 * The cost is honest and small: two people saving the same child in the same
 * second would each log `from` as the value they read, so the second row names
 * a predecessor that was already superseded. The record ends up right, the
 * trail is briefly imprecise about one intermediate value, and buying that back
 * would mean a WebSocket round trip on every edit in a three-person office.
 */
export async function writeOfficeEdit(input: {
  studentId: string;
  changes: FieldChange[];
  decidedBy: string;
  note?: string | null;
}): Promise<void> {
  const { studentId, changes, decidedBy } = input;
  if (changes.length === 0) return;

  const now = new Date();

  await db.batch([
    db.insert(schema.changeLog).values(
      changes.map((row) => ({
        // No submission: nobody proposed this, an approver typed it. See the
        // column's own comment in drizzle/schema.ts.
        submissionId: null,
        studentId,
        fieldKey: row.logKey,
        fromValue: row.from,
        toValue: row.toValue,
        decision: "edited",
        decidedBy,
        note: input.note ?? null,
      })),
    ),

    // ONE update, unlike the review path's one-per-row: every field here is on
    // the same student.
    db
      .update(schema.students)
      .set({
        ...Object.fromEntries(changes.map((row) => [row.column, row.to])),
        updatedAt: now,
      })
      .where(eq(schema.students.id, studentId)),

    // Not recordOrigins(): that helper runs its own statements and would land
    // outside this batch, which is the one thing the note above forbids.
    db
      .insert(schema.valueSources)
      .values(
        changes.map((row) => ({
          ...officeOrigin(studentId, row.dbName),
          sourceUpdatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.valueSources.studentId, schema.valueSources.fieldKey],
        set: { sourceKey: sql`excluded."source_key"`, sourceUpdatedAt: now },
      }),
  ]);
}
