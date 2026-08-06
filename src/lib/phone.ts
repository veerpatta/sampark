/**
 * One implementation of "what is this number, really".
 *
 * This logic used to live only inside the teacher form's input handler, which
 * meant the office typing a number into the request builder got none of it, and
 * the server got whatever survived. A phone number arrives in this school as
 * "+91 98765 43210", "098765 43210", "98765-43210" and "9876543210", from a
 * paper register, a WhatsApp forward, or a fee-app export, and every one of
 * those is the same number.
 *
 * Pure, no imports, no database — so it runs identically in the browser, in a
 * route handler, and in a test.
 */

/** Indian mobile numbers are ten digits. The country code is added at send. */
export const PHONE_LENGTH = 10;

/**
 * Strip everything that cannot be part of the number, then drop a country code
 * or a trunk prefix if what is left is too long to be either.
 *
 * The length checks matter: a bare ten-digit number starting 91… or 0… is
 * plausible in principle, so only strip when there are more digits than a
 * number can hold, which is the only case where the leading digits must be a
 * prefix rather than the number itself.
 */
export function normalisePhone(raw: string | null | undefined): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length > PHONE_LENGTH && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  if (digits.length > PHONE_LENGTH && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits.slice(0, PHONE_LENGTH);
}

/** True once it is a complete number. Blank is not an error, just not done. */
export function isCompletePhone(raw: string | null | undefined): boolean {
  return normalisePhone(raw).length === PHONE_LENGTH;
}

/** Blank counts as "no number saved" — the column is NOT NULL, so it is "". */
export function hasPhone(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim() !== "";
}

/** Two numbers are the same number if they normalise the same. */
export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return normalisePhone(a) === normalisePhone(b);
}
