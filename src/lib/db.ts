import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleSocket } from "drizzle-orm/neon-serverless";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
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

/**
 * The default connection: one HTTP round trip per statement. Right for almost
 * everything here — a page render, an import chunk, a roster read.
 */
export const db = drizzle(sql, { schema });
export { schema };

/**
 * Run a real, interactive transaction.
 *
 * The HTTP driver above cannot do this. It can send a batch atomically, but it
 * cannot let us READ a result partway through and branch on it — and the review
 * approval path is built entirely on doing exactly that:
 *
 *     UPDATE submissions SET review_status = 'approved'
 *      WHERE id = ANY(...) AND review_status = 'pending'
 *      RETURNING ...
 *
 * That `AND review_status = 'pending'` guard is what makes a double approval a
 * no-op (plan section 6), and the rows it actually returns are what we then
 * write to change_log and into the master record. Approving rows we did not
 * just claim would double-count; writing before knowing would break the guard.
 *
 * So this path opens a WebSocket connection instead, which supports BEGIN /
 * COMMIT / ROLLBACK properly. It is slower to set up, which is why it is not
 * the default — use it only where atomicity across several statements is the
 * point.
 *
 * The pool is created and closed per call. In a serverless function that is the
 * correct shape: there is no process to keep a pool warm for, and a leaked
 * connection outlives the request that opened it.
 */
export async function withTransaction<T>(
  work: (tx: Parameters<Parameters<NeonDatabase<typeof schema>["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  if (typeof globalThis.WebSocket !== "function") {
    // Node 22.4+ and every modern browser runtime provide this. If a deploy
    // target ever does not, the fix is `neonConfig.webSocketConstructor = ws`
    // plus the `ws` dependency — fail loudly rather than silently degrade to a
    // non-transactional path, because that would break the approval guard.
    throw new Error(
      "No global WebSocket, so an interactive transaction cannot be opened.",
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const tx = drizzleSocket(pool, { schema });
    return await tx.transaction(work);
  } finally {
    await pool.end();
  }
}
