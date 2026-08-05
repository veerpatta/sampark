"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { db, schema } from "@/lib/db";
import {
  canManageSettings,
  isRole,
  requireUser,
  ROLES,
} from "@/lib/auth/session";

/**
 * Admin console accounts. Owner only.
 *
 * Teachers never appear here — they have no account and never will, which is
 * principle 1. This is three to five office people.
 *
 * Passwords are hashed with bcrypt at cost 12 and the plaintext is never
 * stored, logged or returned. `npm run db:create-user` does the same thing from
 * a terminal, and remains the way to create the first account on a fresh
 * database, when there is nobody to sign in as.
 */
async function requireOwner() {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    throw new Error("Only the owner can manage admin users.");
  }
  return user;
}

export async function saveUser(formData: FormData) {
  const owner = await requireOwner();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email.includes("@")) throw new Error("That is not an email address.");
  if (!name) throw new Error("Name is required.");
  if (!isRole(role)) throw new Error(`Role must be one of: ${ROLES.join(", ")}`);
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters.");
  }

  const id = email.split("@")[0]!.replace(/[^a-z0-9]/g, "").slice(0, 32);
  if (!id) throw new Error("That email produces an empty user id.");

  const passwordHash = await hash(password, 12);

  await db
    .insert(schema.users)
    .values({ id, email, name, passwordHash, role, active: true })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { name, passwordHash, role, active: true },
    });

  // The owner can demote themselves by re-saving their own row with a lower
  // role. Guard it: locking every owner out of the field registry and user
  // management would need a terminal and the database to undo.
  if (email === owner.email && role !== "owner") {
    await db
      .update(schema.users)
      .set({ role: "owner" })
      .where(eq(schema.users.id, owner.id));
    throw new Error(
      "You cannot demote your own account — ask another owner to do it.",
    );
  }

  revalidatePath("/settings/users");
}

/**
 * Deactivate rather than delete: change_log.decided_by references users, and
 * an audit trail that cannot name who approved something is not an audit trail.
 *
 * Deactivation takes effect immediately, not when the session expires — every
 * guarded call re-reads the row. See currentUser() in lib/auth/session.ts.
 */
export async function setUserActive(formData: FormData) {
  const owner = await requireOwner();

  const id = String(formData.get("id") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  if (id === owner.id && !active) {
    throw new Error("You cannot deactivate the account you are signed in with.");
  }

  await db
    .update(schema.users)
    .set({ active })
    .where(eq(schema.users.id, id));

  revalidatePath("/settings/users");
}
