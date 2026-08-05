import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Rate limiting for the teacher-facing surface.
 *
 * Budgets from SAMPARK_BUILD_PLAN.md section 5:
 *   - 30 requests / minute per token
 *   - 100 requests / hour per IP
 *
 * Counted in Postgres, not in memory. Vercel runs many instances and each would
 * keep its own private tally, so an in-memory limit of 30 across ten instances
 * is really a limit of 300 — which is not a limit. The plan offers Upstash or a
 * Neon counter table; the table avoids a second service to keep alive and a
 * dependency the plan does not require.
 *
 * The whole check is one upsert. The CASE resets the window in the same
 * statement that increments it, so two concurrent requests cannot both decide
 * the window has expired and both reset the count to 1.
 */

export const LIMITS = {
  perToken: { limit: 30, windowMs: 60_000 },
  perIp: { limit: 100, windowMs: 60 * 60_000 },
} as const;

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

async function hit(
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const seconds = Math.ceil(windowMs / 1000);

  const rows = (await db.execute(sql`
    INSERT INTO rate_limits (bucket, window_start, count)
    VALUES (${bucket}, now(), 1)
    ON CONFLICT (bucket) DO UPDATE SET
      window_start = CASE
        WHEN rate_limits.window_start < now() - make_interval(secs => ${seconds})
        THEN now() ELSE rate_limits.window_start END,
      count = CASE
        WHEN rate_limits.window_start < now() - make_interval(secs => ${seconds})
        THEN 1 ELSE rate_limits.count + 1 END
    RETURNING count,
      extract(epoch from (window_start + make_interval(secs => ${seconds}) - now()))::int AS retry_after
  `)) as unknown as { rows: { count: number; retry_after: number }[] };

  const row = rows.rows[0];
  if (!row) return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };

  return {
    ok: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    retryAfterSeconds: Math.max(0, row.retry_after),
  };
}

export function limitByToken(token: string): Promise<RateLimitResult> {
  const { limit, windowMs } = LIMITS.perToken;
  return hit(`token:${token}`, limit, windowMs);
}

export function limitByIp(ip: string): Promise<RateLimitResult> {
  const { limit, windowMs } = LIMITS.perIp;
  return hit(`ip:${ip}`, limit, windowMs);
}

/** Best-effort client IP from Vercel's forwarding headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * Drop windows that closed long ago. Called opportunistically from the teacher
 * route; there is no cron here and the table is tiny, so a cheap sweep on a
 * fraction of requests is enough to stop it growing without bound.
 */
export async function sweepRateLimits(): Promise<void> {
  await db.execute(
    sql`DELETE FROM rate_limits WHERE window_start < now() - interval '2 hours'`,
  );
}
