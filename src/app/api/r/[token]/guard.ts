import {
  clientIp,
  limitByIp,
  limitByToken,
  limitPhotoReadsByIp,
  limitPhotoReadsByToken,
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

/**
 * Reading a photo back has its own budget, and must.
 *
 * A GET proxies an immutable blob and can store nothing, so it is not what the
 * upload budget defends against — and sharing that budget meant opening a
 * half-finished round spent the whole minute's uploads on thumbnails. See
 * perPhotoReadToken in lib/ratelimit.ts.
 */
const PHOTO_READS: Limiters = ({ token, ip }) => [
  limitPhotoReadsByToken(token),
  limitPhotoReadsByIp(ip),
];

const BUCKETS = {
  answers: ANSWERS,
  photos: PHOTOS,
  "photo-reads": PHOTO_READS,
} as const;

export async function guard(
  request: Request,
  token: string,
  kind: keyof typeof BUCKETS = "answers",
): Promise<Response | null> {
  const ip = clientIp(request.headers);
  const results = await Promise.all(BUCKETS[kind]({ token, ip }));

  const worst = results.find((result) => !result.ok);
  if (!worst) return null;

  return new Response(null, {
    status: 429,
    headers: { "retry-after": String(Math.max(1, worst.retryAfterSeconds)) },
  });
}
