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
const teacherSurfaceHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store, max-age=0" },
];

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

/**
 * The office's photo proxy.
 *
 * NOT teacher-facing — there is no token in its URL, it is guarded by the admin
 * session — so it does not belong in the list above and must not get no-store,
 * which would make a students board re-fetch a hundred faces on every scroll.
 * It does need noindex: it serves photographs of children, and a URL that ends
 * in a bare `?p=` is exactly the shape a crawler will follow if it finds one.
 *
 * The teacher's own photo route needs nothing here — it lives under
 * `/api/r/:path*` and inherits that rule, which is why it was put there.
 */
const photoHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      { source: "/r/:path*", headers: teacherSurfaceHeaders },
      { source: "/api/r/:path*", headers: teacherSurfaceHeaders },
      { source: "/t/:path*", headers: teacherSurfaceHeaders },
      { source: "/api/photos", headers: photoHeaders },
    ];
  },
};

export default nextConfig;
