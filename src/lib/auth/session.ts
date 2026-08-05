/**
 * Admin session and role rules.
 *
 * Auth.js v5 with a Credentials provider — three to five users, no third-party
 * dependency, no cost. The provider wiring itself lands in Phase 1; the role
 * predicates below are here now because they are referenced from route guards
 * and are worth getting right once.
 *
 * See SAMPARK_BUILD_PLAN.md sections 4.1 and 5.
 */

export const ROLES = ["owner", "admin", "office"] as const;
export type Role = (typeof ROLES)[number];

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * THE rule that matters: `office` can create requests and view everything, but
 * cannot approve a change into the master record. Only `admin` and `owner`.
 */
export function canApproveIntoMaster(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Field registry edits and user management are owner-only. */
export function canManageSettings(role: Role): boolean {
  return role === "owner";
}

/** Everyone with a login can create a request and view the boards. */
export function canCreateRequests(role: Role): boolean {
  return isRole(role);
}

/**
 * TODO (Phase 1): export `auth`, `signIn`, `signOut` from NextAuth() configured
 * with the Credentials provider, a JWT session of SESSION_MAX_AGE_SECONDS, and
 * a secure httpOnly cookie. Look up the user by email in `users`, compare with
 * bcrypt against `password_hash`, and reject when `active` is false.
 */
