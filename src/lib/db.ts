import { neon, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
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
export { schema };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Locally: copy .env.example to .env.local and " +
        "fill it in. On Vercel: add it to the project's environment variables " +
        "and redeploy — env changes do not apply to a running deployment.",
    );
  }
  return url;
}

let client: NeonHttpDatabase<typeof schema> | null = null;

function connect(): NeonHttpDatabase<typeof schema> {
  client ??= drizzle(neon(connectionString()), { schema });
  return client;
}

/**
 * The default connection: one HTTP round trip per statement. Right for almost
 * everything here — a page render, an import chunk, a roster read.
 *
 * Connected LAZILY, on first use, behind a proxy.
 *
 * This module used to throw at import time when DATABASE_URL was missing, which
 * broke the Vercel build rather than any request: `next build` imports every
 * route module to collect page data, so a missing runtime secret failed the
 * build with "Failed to collect page data for /api/auth/[...nextauth]" — a
 * message that says nothing about the actual cause. Nothing here is rendered at
 * build time, so the build has no business needing database credentials at all.
 *
 * Now an absent DATABASE_URL surfaces on the first query, with a message that
 * names the fix.
 */
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, property) {
    const real = connect();
    const value = Reflect.get(real, property) as unknown;
    // Bind methods to the real instance: Drizzle's builders rely on `this`, and
    // an unbound method called through the proxy would lose it.
    return typeof value === "function" ? value.bind(real) : value;
  },
});

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

  const pool = new Pool({ connectionString: connectionString() });
  try {
    const tx = drizzleSocket(pool, { schema });
    return await tx.transaction(work);
  } finally {
    await pool.end();
  }
}
