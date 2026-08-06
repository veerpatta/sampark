"use client";

import type { RowState } from "./types";

/**
 * Draft persistence, keyed by token.
 *
 * Amet and the villages around it do not have reliable signal. A teacher who
 * has checked thirty names and then walks into a dead spot must not lose those
 * thirty taps — so every change is written to the phone immediately, and the
 * page reloads from there.
 *
 * localStorage rather than IndexedDB on purpose: the payload is a few kilobytes
 * of strings, it is synchronous, and it works on the old Android browsers these
 * phones actually run. IndexedDB would be the right answer for megabytes; this
 * is not that.
 *
 * The draft holds only what SHE typed. The roster and its frozen values come
 * from the server, so a stale draft can never resurrect data the office has
 * since corrected.
 */
/**
 * The batch currently being uploaded, or the last one that failed.
 *
 * One key per upload, held until that upload is acknowledged. Not one key per
 * session: a student can legitimately appear in two uploads — she corrects a row
 * after it has already gone — and reusing the key would collide with the unique
 * index on (idempotency_key, student_id, field_key), where `onConflictDoNothing`
 * would silently drop the correction. Nor a fresh key per retry, which would
 * write the same batch twice. Per upload is the only shape that is neither.
 */
export type PendingBatch = {
  key: string;
  studentIds: string[];
};

export type Draft = {
  version: 2;
  rows: Record<string, RowState>;
  /** Students the server has confirmed it holds. */
  sent: string[];
  /** The upload in flight or awaiting retry, so a replay is not a second write. */
  pending: PendingBatch | null;
  savedAt: number;
};

/** Version 1: one idempotency key for the whole session, no per-batch record. */
type DraftV1 = {
  version: 1;
  rows: Record<string, RowState>;
  sent: string[];
  idempotencyKey: string | null;
  savedAt: number;
};

const KEY_PREFIX = "sampark.draft.";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CURRENT_VERSION = 2;

const keyFor = (token: string) => `${KEY_PREFIX}${token}`;

export function loadDraft(token: string): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(token));
    if (!raw) return null;

    const stored = JSON.parse(raw) as Draft | DraftV1;
    const draft = migrate(stored);
    if (!draft) return null;

    // A month-old draft is for a request that has long since closed. Dropping
    // it is kinder than showing her stale work she cannot submit.
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      clearDraft(token);
      return null;
    }
    return draft;
  } catch {
    // Corrupt or unavailable storage (private mode, quota) must never stop the
    // page rendering. She loses the draft, not the ability to work.
    return null;
  }
}

/**
 * Bring an older draft forward rather than discarding it.
 *
 * A version bump lands mid-session for whoever has the page open, and returning
 * null here would wipe the work of every teacher who was part way through when
 * the deploy went out. A v1 key covered "everything answered but unsent", so it
 * is carried over with no student list — the retry that uses it will simply
 * re-send whatever is still outstanding under the same key, which is exactly
 * what v1 did.
 */
function migrate(stored: Draft | DraftV1): Draft | null {
  if (stored.version === CURRENT_VERSION) return stored as Draft;

  if (stored.version === 1) {
    const old = stored as DraftV1;
    return {
      version: 2,
      rows: old.rows ?? {},
      sent: old.sent ?? [],
      pending: old.idempotencyKey
        ? { key: old.idempotencyKey, studentIds: [] }
        : null,
      savedAt: old.savedAt ?? Date.now(),
    };
  }

  return null;
}

export function saveDraft(
  token: string,
  draft: Omit<Draft, "version" | "savedAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      keyFor(token),
      JSON.stringify({
        ...draft,
        version: CURRENT_VERSION,
        savedAt: Date.now(),
      } as Draft),
    );
  } catch {
    /* quota or private mode — nothing useful to do, and nothing to break */
  }
}

export function clearDraft(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(token));
  } catch {
    /* ignore */
  }
}

/** A url-safe batch id. crypto.randomUUID is not on every old Android browser. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
