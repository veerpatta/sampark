import { cache } from "react";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";

/**
 * Admin session and role rules.
 *
 * Auth.js v5 with a Credentials provider — three to five users, no third-party
 * dependency, no cost. See SAMPARK_BUILD_PLAN.md sections 4.1 and 5.
 *
 * This covers the ADMIN console only. Teachers never have an account, a
 * password, or a login screen; the token in the URL is the entire onboarding,
 * and that lives in `token.ts`. The two must not learn about each other.
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

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        // Compare even when the user is missing or disabled, so a wrong email
        // and a wrong password take the same time to fail.
        const hash = user?.passwordHash ?? NO_SUCH_USER_HASH;
        const matches = await compare(password, hash);

        if (!user || !user.active || !matches) return null;
        if (!isRole(user.role)) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.uid ?? "");
      session.user.role = token.role as Role;
      return session;
    },
  },
});

/**
 * A real bcrypt hash of 32 discarded random bytes. Nothing can match it.
 *
 * It exists so the login path runs a genuine bcrypt comparison even when the
 * email is unknown — without it, an unknown address returns in a millisecond
 * and a known one takes ~80ms, which is enough to enumerate our five accounts.
 * It has to be a well-formed hash: bcryptjs throws on a malformed one, and a
 * thrown error would leak the same fact a fast return does.
 */
const NO_SUCH_USER_HASH =
  "$2b$10$XOWKTJunJ2k.R2BW/QGaFOy8M.MWK1O.NPaCkgHh.7MkWqutBQJae";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

/**
 * The signed-in user, re-checked against the database.
 *
 * The session is a JWT, which means it is self-contained and believed for its
 * full 8 hours without anyone asking Postgres. That is fine for performance and
 * wrong for revocation: deactivating an account, deleting it, or demoting an
 * admin to office would otherwise have no effect until the token expired. This
 * was not theoretical — a deleted account stayed signed in during testing.
 *
 * So the row is read on every guarded call and the ROLE comes from the database,
 * not from the token. One indexed lookup for three to five users is nothing
 * against the cost of a revoked account still being able to approve changes.
 *
 * Read it once per REQUEST, though, not once per caller. The (admin) layout
 * asks, and then so does the page inside it, and so does whatever that page
 * renders — nine JWT decodes and nine SELECTs to answer the same question, all
 * in the same render pass. `cache()` below collapses them into one.
 */
async function loadCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);

  if (!user || !user.active || !isRole(user.role)) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

/**
 * Memoised for the lifetime of ONE request, via React's per-request cache.
 *
 * This must never become `unstable_cache` or `"use cache"`. Those persist
 * across requests, which would put the revocation guarantee above straight back
 * where it was — a deactivated account signed in until someone remembered to
 * revalidate. A server action is its own request and re-reads; that is the
 * behaviour we want.
 */
export const currentUser = cache(loadCurrentUser);

/**
 * Guard for route handlers and server actions. The (admin) layout redirects
 * browsers to /login, but a layout does not protect /api — anything under it
 * that touches data calls this first.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Thrown by requireUser; route handlers turn it into a 401. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthorizedError";
  }
}

/** Thrown when a signed-in user lacks the role for an action; becomes a 403. */
export class ForbiddenError extends Error {
  constructor(message = "Not permitted") {
    super(message);
    this.name = "ForbiddenError";
  }
}
