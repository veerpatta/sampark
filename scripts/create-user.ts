import "../drizzle/env";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hash } from "bcryptjs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import { ROLES } from "../src/lib/auth/session";

/**
 * Create or update an admin console user.
 *
 *   npm run db:create-user
 *
 * Interactive on purpose. Real names, real email addresses and real passwords
 * belong in the database, never in a seed file — THE REPO IS PUBLIC. This is
 * also why there is no users entry in drizzle/seed/.
 *
 * Re-running with an existing email resets that user's password, which is the
 * recovery path when someone forgets theirs.
 */
async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const ask = lineReader();

  console.log("The password is echoed as you type it. Nobody behind you, then.\n");
  const email = (await ask("email: ")).trim().toLowerCase();
  const name = (await ask("full name: ")).trim();
  const role = (await ask(`role (${ROLES.join(" | ")}): `)).trim();
  const password = (await ask("password: ")).trim();

  if (!email.includes("@")) throw new Error("that is not an email address");
  if (!name) throw new Error("name is required");
  if (!(ROLES as readonly string[]).includes(role)) {
    throw new Error(`role must be one of: ${ROLES.join(", ")}`);
  }
  if (password.length < 10) {
    throw new Error("password must be at least 10 characters");
  }

  const db = drizzle(neon(url), { schema });
  const passwordHash = await hash(password, 12);
  const id = email.split("@")[0]!.replace(/[^a-z0-9]/g, "").slice(0, 32);

  await db
    .insert(schema.users)
    .values({ id, email, name, passwordHash, role, active: true })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: {
        name: sql`excluded."name"`,
        passwordHash: sql`excluded."password_hash"`,
        role: sql`excluded."role"`,
        active: sql`true`,
      },
    });

  console.log(`\n${email} can now sign in as ${role}`);
}

/**
 * Prompt for one line at a time.
 *
 * Built on readline's async iterator rather than rl.question() because
 * question() silently never resolves once stdin has already ended — which is
 * exactly what happens when this script is piped or run from a CI shell, and it
 * fails by hanging rather than by saying anything.
 */
function lineReader(): (prompt: string) => Promise<string> {
  const lines = createInterface({ input: stdin })[Symbol.asyncIterator]();
  return async (prompt: string) => {
    stdout.write(prompt);
    const { value, done } = await lines.next();
    if (done) throw new Error("input ended before every question was answered");
    return String(value);
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
