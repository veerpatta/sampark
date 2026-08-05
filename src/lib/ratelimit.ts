/**
 * Rate limiting for the teacher-facing surface.
 *
 * Budgets from SAMPARK_BUILD_PLAN.md section 5:
 *   - 30 requests / minute per token
 *   - 100 requests / hour per IP
 *
 * The in-memory limiter below is correct for a single process and is fine for
 * local development. It is NOT correct on Vercel, where each serverless
 * instance holds its own map — swap in Upstash Redis (or a Neon counter table)
 * before Phase 6 hardening. Guarded by UPSTASH_REDIS_REST_URL being set.
 */

export const LIMITS = {
  perToken: { limit: 30, windowMs: 60_000 },
  perIp: { limit: 100, windowMs: 60 * 60_000 },
} as const;

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    return { ok: true, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Opportunistic cleanup so the map does not grow without bound. */
function sweep() {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function limitByToken(token: string): RateLimitResult {
  if (buckets.size > 5_000) sweep();
  const { limit, windowMs } = LIMITS.perToken;
  return hit(`token:${token}`, limit, windowMs);
}

export function limitByIp(ip: string): RateLimitResult {
  if (buckets.size > 5_000) sweep();
  const { limit, windowMs } = LIMITS.perIp;
  return hit(`ip:${ip}`, limit, windowMs);
}

/** Best-effort client IP from Vercel's forwarding headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
