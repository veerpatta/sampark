"use server";

import { revalidatePath } from "next/cache";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canCreateRequests, requireUser } from "@/lib/auth/session";
import { slugFieldKey } from "@/lib/field-keys";
import { ADHOC_KIND } from "@/lib/requests";

/**
 * A one-off question, added while building a request.
 *
 * OFFICE-LEVEL, AND THAT IS THE WHOLE DESIGN OF THIS FILE.
 *
 * The field registry in Settings is owner-only for one reason, stated there: a
 * wrong `target_column` writes teacher answers into the wrong column of the
 * master student record. An ad-hoc question is DEFINED by having no target
 * column. It can never touch `students`, never enters `value_sources`, and never
 * engages the precedence rule — its answers live in student_records against the
 * request that asked them. The worst it can do is leave a badly-named row in a
 * side table.
 *
 * So rather than loosening `saveField` to let the office at it, this cuts a
 * separate, much smaller door: `targetColumn`, `recordKind` and `mode` are
 * hard-coded here and are not read from the form at all. There is no input this
 * action could receive that would make it write to a master column.
 */

const INPUT_TYPES = ["text", "number", "select", "date", "tel", "boolean"];

export type AdhocField = {
  key: string;
  labelEn: string;
  labelHi: string;
  inputType: string;
};

export type AdhocResult =
  | { ok: true; field: AdhocField }
  | { ok: false; error: string };

export async function createAdhocField(input: {
  labelEn: string;
  labelHi: string;
  inputType: string;
  options?: string;
  maxValue?: string;
}): Promise<AdhocResult> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return { ok: false, error: "Your role cannot create requests." };
  }

  const labelEn = input.labelEn.trim();
  const labelHi = input.labelHi.trim();
  const inputType = input.inputType.trim();

  if (!labelEn) return { ok: false, error: "Give the question a name." };
  if (!labelHi) {
    // The teacher surface is Hindi-first and there is nothing to fall back to.
    return {
      ok: false,
      error: "The Hindi label is what the teacher actually reads — it is required.",
    };
  }
  if (!INPUT_TYPES.includes(inputType)) {
    return { ok: false, error: `Answer type must be one of: ${INPUT_TYPES.join(", ")}` };
  }

  const options = (input.options ?? "")
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);

  if (inputType === "select" && options.length < 2) {
    return {
      ok: false,
      error: "A dropdown needs at least two choices, comma separated.",
    };
  }

  const existing = await db
    .select({ key: schema.fieldDefs.key })
    .from(schema.fieldDefs);

  let key: string;
  try {
    key = slugFieldKey(labelEn, new Set(existing.map((row) => row.key)));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not name that field.",
    };
  }

  const maxValue = (input.maxValue ?? "").trim();
  if (maxValue && !Number.isFinite(Number(maxValue))) {
    return { ok: false, error: "The maximum must be a number." };
  }

  await db.insert(schema.fieldDefs).values({
    key,
    labelEn,
    labelHi,
    // Not from the form. See the note at the top of this file.
    mode: "collect",
    targetColumn: null,
    recordKind: ADHOC_KIND,
    inputType,
    options: inputType === "select" ? options : null,
    maxValue: inputType === "number" && maxValue ? maxValue : null,
    exactLen: null,
    pattern: null,
    // Below the registry's real fields, which sit at 100 and under.
    sortOrder: 500,
    active: true,
  });

  revalidatePath("/requests/new");
  revalidatePath("/requests/bulk");
  revalidatePath("/settings/fields");

  return { ok: true, field: { key, labelEn, labelHi, inputType } };
}

/** The questions already added, so the builder can offer them again. */
export async function listAdhocFields(): Promise<AdhocField[]> {
  const rows = await db
    .select()
    .from(schema.fieldDefs)
    .orderBy(asc(schema.fieldDefs.labelEn));

  return rows
    .filter((row) => row.recordKind === ADHOC_KIND && row.active)
    .map((row) => ({
      key: row.key,
      labelEn: row.labelEn,
      labelHi: row.labelHi,
      inputType: row.inputType,
    }));
}
