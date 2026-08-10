import type { NextConfig } from "next";

/**
 * Security headers for the teacher-facing surface.
 *
 * `/r/*` and `/t/*` are both reached by a bearer token in the URL. Two things
 * must never happen:
 *   1. a search engine indexing a live token
 *   2. the token leaking to a third party via the Referer header
 *
 * It matters MORE on `/t/*`: one indexed or cached document there lists every
 * request token that teacher currently holds, where `/r/*` leaks one. Adding a
 * teacher-facing route without adding it here is the easy mistake, so
 * tests/headers.test.ts fails when a prefix is missing.
 *
 * See SAMPARK_BUILD_PLAN.md section 5.
 */
/**
 * The two that apply to EVERY teacher-facing URL, with no exception.
 *
 * A token in a URL must never be indexed and must never ride the Referer to a
 * third party. Nothing about what a route returns changes either of those.
 */
const tokenSafetyHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

/**
 * And the third, which applies to everything that carries roster data or
 * renders a token — but NOT to an immutable image.
 *
 * A rule here beats a header set in a route handler, so `no-store` on the whole
 * `/api/r/*` prefix silently overrode the photo route's cache header and made a
 * browser re-fetch every face it had already been shown. Rather than write a
 * header that does nothing, the prefix is narrowed: the wildcard keeps the two
 * headers that must never be missed, and no-store is attached to the endpoints
 * that actually return a roster.
 */
const noStore = { key: "Cache-Control", value: "no-store, max-age=0" };

const teacherSurfaceHeaders = [...tokenSafetyHeaders, noStore];

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      { source: "/r/:path*", headers: teacherSurfaceHeaders },
      { source: "/t/:path*", headers: teacherSurfaceHeaders },

      // Everything under the teacher API, whatever it returns.
      { source: "/api/r/:path*", headers: tokenSafetyHeaders },
      // The answers endpoint specifically. `:token` is ONE segment, so this
      // matches /api/r/<token> and deliberately not /api/r/<token>/photo.
      { source: "/api/r/:token", headers: [noStore] },

      /**
       * The office's photo proxy. Not teacher-facing — no token in its URL, an
       * admin session instead — but it serves photographs of children, and a
       * URL ending in a bare `?p=` is exactly what a crawler follows. Its
       * caching is decided in the route handler, where the reasoning lives.
       */
      { source: "/api/photos", headers: tokenSafetyHeaders },
    ];
  },
};

export default nextConfig;
