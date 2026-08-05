import type { NextConfig } from "next";

/**
 * Security headers for the teacher-facing surface.
 *
 * `/r/*` is reached by a bearer token in the URL. Two things must never happen:
 *   1. a search engine indexing a live token
 *   2. the token leaking to a third party via the Referer header
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

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      { source: "/r/:path*", headers: teacherSurfaceHeaders },
      { source: "/api/r/:path*", headers: teacherSurfaceHeaders },
    ];
  },
};

export default nextConfig;
