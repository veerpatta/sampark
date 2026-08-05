import { getTableColumns } from "drizzle-orm";
import { schema } from "./db";
import type { Student } from "../../drizzle/schema";

/**
 * Bridging `field_defs.target_column` to the students row.
 *
 * The registry stores a DATABASE column name — 'father_name'. A row that comes
 * back from Drizzle is keyed by the PROPERTY name — 'fatherName'. For `phone`,
 * `dob`, `village`, `aadhaar` and `category` these are the same string, which is
 * exactly what makes getting it wrong so easy to miss: half the registry works
 * and the other half silently reads `undefined`.
 *
 * That is not hypothetical. The roster snapshot was built with the raw DB name
 * for a while, so every field whose two names differ — father_name, mother_name,
 * alt_phone, jan_aadhaar, bus_route — was frozen as blank. Teachers would have
 * been asked to re-type data the school already held, which is the one thing
 * this product exists to avoid.
 *
 * Derived from the schema rather than written out, so adding a column cannot
 * leave a stale copy here.
 */
const PROTECTED = new Set(["id", "created_at", "updated_at", "source"]);

export const STUDENT_COLUMN_BY_DB_NAME = new Map(
  Object.entries(getTableColumns(schema.students))
    .filter(([, column]) => !PROTECTED.has(column.name))
    .map(([property, column]) => [column.name, property]),
);

/**
 * Read the value a field points at, or null when the registry names a column
 * that does not exist (or one we refuse to expose).
 */
export function readStudentColumn(
  student: Student,
  targetColumn: string | null,
): string | null {
  if (!targetColumn) return null;
  const property = STUDENT_COLUMN_BY_DB_NAME.get(targetColumn);
  if (!property) return null;

  const value = student[property as keyof Student];
  return value === null || value === undefined || value === "" ? null : String(value);
}
