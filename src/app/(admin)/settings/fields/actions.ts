"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, requireUser } from "@/lib/auth/session";
import { STUDENT_COLUMN_BY_DB_NAME } from "@/lib/student-columns";

/**
 * The field registry editor.
 *
 * Rule 11: adding a collectable field must stay a database row, not a
 * deployment. This screen is what makes that true — without it the registry is
 * only nominally data, because changing it would still mean editing the seed
 * file and pushing.
 *
 * Owner only. A wrong `target_column` here writes teacher answers into the
 * wrong column of the master record, so it is not an office-level control.
 */
async function requireOwner() {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    throw new Error("Only the owner can edit the field registry.");
  }
  return user;
}

const INPUT_TYPES = ["text", "tel", "date", "number", "select"];
const MODES = ["verify", "collect"];

export async function saveField(formData: FormData) {
  await requireOwner();

  const key = String(formData.get("key") ?? "").trim();
  const labelEn = String(formData.get("labelEn") ?? "").trim();
  const labelHi = String(formData.get("labelHi") ?? "").trim();
  const mode = String(formData.get("mode") ?? "").trim();
  const inputType = String(formData.get("inputType") ?? "").trim();
  const targetColumn = String(formData.get("targetColumn") ?? "").trim() || null;
  const recordKind = String(formData.get("recordKind") ?? "").trim() || null;
  const exactLenRaw = String(formData.get("exactLen") ?? "").trim();
  const maxValueRaw = String(formData.get("maxValue") ?? "").trim();
  const optionsRaw = String(formData.get("options") ?? "").trim();
  const sortOrderRaw = String(formData.get("sortOrder") ?? "").trim();
  const active = formData.get("active") === "on";

  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
    throw new Error(
      "Key must be lowercase letters, digits and underscores, e.g. bank_account.",
    );
  }
  if (!labelEn || !labelHi) {
    throw new Error("Both the English and the Hindi label are required.");
  }
  if (!MODES.includes(mode)) throw new Error("Mode must be verify or collect.");
  if (!INPUT_TYPES.includes(inputType)) {
    throw new Error(`Input type must be one of: ${INPUT_TYPES.join(", ")}`);
  }

  // The single most dangerous value on this form. An unknown column name would
  // silently swallow every approval for the field (see student-columns.ts), and
  // a protected one would let the registry point at a primary key.
  if (targetColumn && !STUDENT_COLUMN_BY_DB_NAME.has(targetColumn)) {
    throw new Error(
      `"${targetColumn}" is not a writable column on students. Leave it blank to store the answer as a period-scoped record instead.`,
    );
  }
  if (!targetColumn && !recordKind) {
    throw new Error(
      "A field with no target column needs a record kind, e.g. fa_marks.",
    );
  }

  const exactLen = exactLenRaw ? Number(exactLenRaw) : null;
  if (exactLen !== null && (!Number.isInteger(exactLen) || exactLen < 1)) {
    throw new Error("Exact length must be a whole number.");
  }
  if (maxValueRaw && !Number.isFinite(Number(maxValueRaw))) {
    throw new Error("Max value must be a number.");
  }

  const options = optionsRaw
    ? optionsRaw
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean)
    : null;
  if (inputType === "select" && (!options || options.length === 0)) {
    throw new Error("A select field needs a comma-separated option list.");
  }

  const values = {
    key,
    labelEn,
    labelHi,
    mode,
    inputType,
    targetColumn,
    recordKind: targetColumn ? null : recordKind,
    exactLen,
    maxValue: maxValueRaw || null,
    options,
    sortOrder: sortOrderRaw ? Number(sortOrderRaw) : 100,
    active,
  };

  await db
    .insert(schema.fieldDefs)
    .values(values)
    .onConflictDoUpdate({ target: schema.fieldDefs.key, set: values });

  revalidatePath("/settings/fields");
  revalidatePath("/requests/new");
}

/**
 * Fields are switched off, never deleted. submissions, change_log and
 * student_records all reference field_defs.key, and an inactive field simply
 * stops being offered on new requests while its history stays readable.
 */
export async function setFieldActive(formData: FormData) {
  await requireOwner();

  const key = String(formData.get("key") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "true";
  if (!key) return;

  await db
    .update(schema.fieldDefs)
    .set({ active })
    .where(eq(schema.fieldDefs.key, key));

  revalidatePath("/settings/fields");
  revalidatePath("/requests/new");
}
