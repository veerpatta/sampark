import { randomBytes } from "node:crypto";

/**
 * ============================================================================
 * THE ONE PLACE AUTHORIZATION LIVES.
 * ============================================================================
 *
 * Neon gives us no row-level security and no anonymous API surface, so every
 * teacher-facing read and write is scoped here and nowhere else. A bug in this
 * file is the expensive kind. It gets tests (Phase 6) and it gets reviewed
 * carefully. See SAMPARK_BUILD_PLAN.md sections 3 and 5.
 *
 * A token resolves to exactly one request -> one class -> one field set.
 * There is no menu, no navigation, and no way to reach another class.
 */

/** Grace period after due_date during which a link still opens. */
export const GRACE_DAYS = 3;

/**
 * 12 random bytes -> 16 url-safe characters -> ~96 bits of entropy.
 * Combined with rate limiting this makes enumeration infeasible.
 */
export function generateToken(): string {
  return randomBytes(12).toString("base64url");
}

export type TokenRejection =
  | "not_found"
  | "expired"
  | "closed"
  | "pin_required"
  | "pin_wrong";

export type TokenCheckInput = {
  status: string; // open | submitted | closed | expired
  dueDate: string | Date;
  pin: string | null;
};

export type TokenCheckResult =
  | { ok: true }
  | { ok: false; reason: TokenRejection };

/**
 * Pure predicate over a request row. Kept separate from the database read so it
 * can be unit tested without a connection.
 *
 * `now` is injectable so expiry tests do not depend on the wall clock.
 */
export function checkRequestAccess(
  request: TokenCheckInput,
  suppliedPin: string | null = null,
  now: Date = new Date(),
): TokenCheckResult {
  if (request.status === "closed" || request.status === "expired") {
    return { ok: false, reason: "closed" };
  }

  const due =
    typeof request.dueDate === "string"
      ? new Date(`${request.dueDate}T23:59:59+05:30`)
      : request.dueDate;

  const hardStop = new Date(due.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  if (now > hardStop) {
    return { ok: false, reason: "expired" };
  }

  if (request.pin) {
    if (!suppliedPin) return { ok: false, reason: "pin_required" };
    if (!timingSafeEqualStr(suppliedPin, request.pin)) {
      return { ok: false, reason: "pin_wrong" };
    }
  }

  return { ok: true };
}

/** Constant-time comparison so the 4-digit PIN cannot be probed by timing. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * TODO (Phase 2): resolveToken(token) — reads the request row, its teacher, the
 * field defs for request.fieldKeys, and the frozen roster from
 * request_students. Returns null for every rejection reason so the route can
 * render an identical 404 in all cases; never leak WHY a token failed.
 */
