import {
  clientIp,
  limitByIp,
  limitByToken,
  limitPhotosByIp,
  limitPhotosByToken,
  type RateLimitResult,
} from "@/lib/ratelimit";

/**
 * Rate limit BEFORE resolving the token.
 *
 * Checking the token first would mean every guess costs a database read of
 * `requests` — the limiter exists precisely to make enumeration expensive for
 * the attacker rather than for us. 96 bits of entropy makes guessing infeasible
 * anyway; this closes the cheap-probe half of it.
 *
 * Shared by both teacher endpoints rather than copied into each. The ORDER here
 * is the security property — a second copy that drifted into resolving first
 * would still look correct and would quietly undo the whole point.
 */

type Limiters = (args: { token: string; ip: string }) => Promise<RateLimitResult>[];

const ANSWERS: Limiters = ({ token, ip }) => [limitByToken(token), limitByIp(ip)];

/**
 * Photos are counted in their own buckets. A class of forty-six photographs
 * would otherwise spend the answer budget, and both would fail by turns. See
 * LIMITS in lib/ratelimit.ts.
 */
const PHOTOS: Limiters = ({ token, ip }) => [
  limitPhotosByToken(token),
  limitPhotosByIp(ip),
];

export async function guard(
  request: Request,
  token: string,
  kind: "answers" | "photos" = "answers",
): Promise<Response | null> {
  const ip = clientIp(request.headers);
  const results = await Promise.all(
    (kind === "photos" ? PHOTOS : ANSWERS)({ token, ip }),
  );

  const worst = results.find((result) => !result.ok);
  if (!worst) return null;

  return new Response(null, {
    status: 429,
    headers: { "retry-after": String(Math.max(1, worst.retryAfterSeconds)) },
  });
}
