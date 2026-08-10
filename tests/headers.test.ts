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

  /**
   * The office's photo proxy is NOT in TEACHER_FACING and must not be: it has
   * no token in its URL and no-store there would make a hundred-row students
   * board re-fetch every face on every scroll. It still serves photographs of
   * children, so noindex is not optional.
   *
   * The teacher's own /api/r/[token]/photo route is deliberately absent from
   * this file — it nests under the `/api/r/:path*` rule already asserted above.
   * Adding a rule for it would be harmless; moving it out from under that
   * prefix would not be, and the assertions above are what would catch that.
   */
  it("keeps children's photographs out of a search index", async () => {
    const rules = await config.headers!();
    const rule = rules.find((entry) => entry.source === "/api/photos");
    assert.ok(rule, "the photo proxy has no header rule");
    const robots = rule.headers.find((header) => header.key === "X-Robots-Tag");
    assert.ok(robots?.value.includes("noindex"));
    assert.ok(
      !rule.headers.some((header) => header.key === "Cache-Control"),
      "no-store here would defeat the browser cache the board depends on",
    );
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
