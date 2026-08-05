import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../../drizzle/schema";

/**
 * The single database entry point.
 *
 * Neon has no anonymous API surface and no row-level security we can lean on,
 * so the browser NEVER connects to the database. Every read and write goes
 * through a Next.js server route, and authorization lives in exactly one place:
 * `src/lib/auth/token.ts`. See SAMPARK_BUILD_PLAN.md section 3.
 *
 * This module must never be imported from a client component.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });
export { schema };
