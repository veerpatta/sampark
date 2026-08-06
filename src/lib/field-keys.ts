/**
 * Turning "T-shirt size" into a field key.
 *
 * The registry key is a database identifier: it is the primary key of
 * field_defs, it is referenced by submissions, student_records and change_log,
 * and it is never renamed once anything points at it. So the office types a
 * label and this derives the key, rather than asking her to invent one and
 * refusing what she types.
 *
 * Pure, and the rule it enforces is the one already in settings/fields:
 * ^[a-z][a-z0-9_]{1,40}$.
 */

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * Prefix for a question the office added while building a request.
 *
 * Worth the four characters: it keeps ad-hoc keys from ever colliding with the
 * registry's real ones — a question called "Phone" must not become `phone` and
 * start pointing at the master column — and it makes them obvious in an export.
 */
const ADHOC_PREFIX = "q_";

export function slugFieldKey(label: string, taken: Set<string>): string {
  const body = slug(label);

  // The prefix alone would satisfy KEY_PATTERN, so a label with nothing usable
  // in it — a Hindi-only one, or punctuation — would silently become "q_" and
  // the next such label would collide with it.
  if (body === "") {
    throw new Error(
      "Give the question a name with some letters in it, for example: T-shirt size.",
    );
  }

  const trimmed = (ADHOC_PREFIX + body).slice(0, 40);

  if (!KEY_PATTERN.test(trimmed)) {
    throw new Error(
      "Give the question a name with some letters in it, for example: T-shirt size.",
    );
  }

  if (!taken.has(trimmed)) return trimmed;

  // A second "T-shirt size" is a different question — last year's and this
  // year's — so it gets its own key rather than quietly overwriting the first.
  for (let n = 2; n < 100; n += 1) {
    const suffix = `_${n}`;
    const candidate = trimmed.slice(0, 40 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error("Too many questions with that name. Give this one a different name.");
}

function slug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    // Devanagari and anything else non-ASCII cannot go in the key, so a Hindi
    // label alone produces nothing here and the English one is required.
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isFieldKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

export const isAdhocKey = (key: string) => key.startsWith(ADHOC_PREFIX);
