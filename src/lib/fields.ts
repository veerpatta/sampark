/**
 * Field registry: loader and validators.
 *
 * The same validation code runs on the client (for instant feedback) and on the
 * server (because the client is never trusted). Keep this module free of
 * server-only imports so both can use it — the DB loader lives at the bottom
 * and is the only server-side part.
 *
 * Principle 5 from the build plan: a 9-digit phone number or 30 marks out of 25
 * must be impossible to SUBMIT, not cleaned up later.
 *
 * A REPEATED PHONE NUMBER IS NOT AN ERROR AND MUST NEVER BE ADDED HERE.
 * 134 numbers in this school are held by more than one student and 133 of those
 * span more than one class: siblings share a parent's phone, which is the normal
 * case and not a mistake. A uniqueness check would reject the correct answer and
 * teach a teacher that the screen is wrong about her own class. The office sees
 * a neutral "also on N other students" line in /review; the teacher sees
 * nothing. See listPendingReview in lib/submissions.ts.
 */
import type { FieldDef } from "../../drizzle/schema";

export type { FieldDef };

export type ValidationResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string; errorHi: string };

const ok = (value: string | null): ValidationResult => ({ ok: true, value });
const fail = (error: string, errorHi: string): ValidationResult => ({
  ok: false,
  error,
  errorHi,
});

/**
 * Validate one raw value against its field definition.
 * Returns a normalised value on success (trimmed, digits-only for tel).
 */
export function validateField(
  def: Pick<
    FieldDef,
    "key" | "labelEn" | "inputType" | "exactLen" | "pattern" | "maxValue" | "options"
  >,
  raw: string | null | undefined,
): ValidationResult {
  const value = (raw ?? "").trim();

  // Blank is always allowed. Blank means "no change", never "erase".
  if (value === "") return ok(null);

  switch (def.inputType) {
    case "tel": {
      const digits = value.replace(/\D/g, "");
      if (def.exactLen && digits.length !== def.exactLen) {
        return fail(
          `${def.labelEn} must be exactly ${def.exactLen} digits`,
          `${def.exactLen} अंक होने चाहिए`,
        );
      }
      if (!def.exactLen && digits.length < 6) {
        return fail(`${def.labelEn} looks too short`, `नंबर बहुत छोटा है`);
      }
      return ok(digits);
    }

    case "number": {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return fail(`${def.labelEn} must be a number`, `केवल अंक भरें`);
      }
      if (num < 0) {
        return fail(`${def.labelEn} cannot be negative`, `ऋणात्मक नहीं हो सकता`);
      }
      const max = def.maxValue === null ? null : Number(def.maxValue);
      if (max !== null && Number.isFinite(max) && num > max) {
        return fail(
          `${def.labelEn} cannot exceed ${max}`,
          `अधिकतम ${max} अंक`,
        );
      }
      return ok(String(num));
    }

    case "date": {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return fail(`${def.labelEn} is not a valid date`, `तिथि सही नहीं है`);
      }
      if (parsed.getTime() > Date.now()) {
        return fail(
          `${def.labelEn} cannot be in the future`,
          `भविष्य की तिथि नहीं हो सकती`,
        );
      }
      // Sanity band for a school roll: age 2-22. See section 9.
      const ageYears =
        (Date.now() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (ageYears < 2 || ageYears > 22) {
        return fail(
          `${def.labelEn} gives an age outside 2-22 years`,
          `आयु 2 से 22 वर्ष के बीच होनी चाहिए`,
        );
      }
      return ok(parsed.toISOString().slice(0, 10));
    }

    case "select": {
      const allowed = Array.isArray(def.options)
        ? (def.options as unknown[]).map(String)
        : [];
      if (allowed.length > 0 && !allowed.includes(value)) {
        return fail(
          `${def.labelEn} must be one of: ${allowed.join(", ")}`,
          `सूची में से चुनें`,
        );
      }
      return ok(value);
    }

    case "text":
    default: {
      if (def.exactLen && value.length !== def.exactLen) {
        return fail(
          `${def.labelEn} must be exactly ${def.exactLen} characters`,
          `${def.exactLen} अक्षर होने चाहिए`,
        );
      }
      if (def.pattern && !new RegExp(def.pattern).test(value)) {
        return fail(`${def.labelEn} is not in the expected format`, `प्रारूप सही नहीं है`);
      }
      return ok(value);
    }
  }
}

/** Does this field write to the students master table, or to student_records? */
export function isMasterField(def: Pick<FieldDef, "targetColumn">): boolean {
  return def.targetColumn !== null && def.targetColumn !== undefined;
}

/** Marks-mode fields skip the confirm step and show inputs directly. */
export function isCollectMode(def: Pick<FieldDef, "mode">): boolean {
  return def.mode === "collect";
}
