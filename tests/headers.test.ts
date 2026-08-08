import { describe, it } from "node:test";
import assert from "node:assert/strict";
import config from "../next.config";

/**
 * Every teacher-facing prefix carries the token headers.
 *
 * `/r/*` and `/t/*` are reached by a bearer token sitting in the URL. Without
 * these three headers a search engine can index a live token, the Referer can
 * hand it to a third party, and an intermediary can cache the page. None of
 * that is visible in a build, a typecheck or a browser — it only shows up as a
 * roster somewhere it should not be, months later.
 *
 * This test exists because adding a route and forgetting next.config.ts is the
 * easy mistake, and nothing else would catch it.
 */
const TEACHER_FACING = ["/r/:path*", "/api/r/:path*", "/t/:path*"];
const REQUIRED = ["X-Robots-Tag", "Referrer-Policy", "Cache-Control"];

describe("security headers", () => {
  it("covers every teacher-facing prefix", async () => {
    const rules = await config.headers!();

    for (const source of TEACHER_FACING) {
      const rule = rules.find((entry) => entry.source === source);
      assert.ok(
        rule,
        `${source} has no header rule — a token there can be indexed or leak via Referer`,
      );
      for (const key of REQUIRED) {
        assert.ok(
          rule.headers.some((header) => header.key === key),
          `${source} is missing ${key}`,
        );
      }
    }
  });

  it("tells robots not to index, follow or archive", async () => {
    const rules = await config.headers!();
    for (const source of TEACHER_FACING) {
      const value = rules
        .find((entry) => entry.source === source)!
        .headers.find((header) => header.key === "X-Robots-Tag")!.value;
      for (const directive of ["noindex", "nofollow", "noarchive"]) {
        assert.ok(value.includes(directive), `${source}: ${directive} missing`);
      }
    }
  });

  it("sends no referrer, so a token cannot ride to a third party", async () => {
    const rules = await config.headers!();
    for (const source of TEACHER_FACING) {
      const value = rules
        .find((entry) => entry.source === source)!
        .headers.find((header) => header.key === "Referrer-Policy")!.value;
      assert.equal(value, "no-referrer");
    }
  });
});
