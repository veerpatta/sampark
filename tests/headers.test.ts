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
const REQUIRED = ["X-Robots-Tag", "Referrer-Policy"];

/** Every rule whose source matches this concrete URL, in declaration order. */
function rulesFor(
  rules: Awaited<ReturnType<NonNullable<typeof config.headers>>>,
  url: string,
) {
  return rules.filter((entry) => {
    const pattern = entry.source
      .replace(/\/:path\*/g, "(?:/.*)?")
      .replace(/:[a-zA-Z]+/g, "[^/]+");
    return new RegExp(`^${pattern}$`).test(url);
  });
}

const headerOn = (
  rules: Awaited<ReturnType<NonNullable<typeof config.headers>>>,
  url: string,
  key: string,
) =>
  rulesFor(rules, url)
    .flatMap((rule) => rule.headers)
    .filter((header) => header.key === key)
    .at(-1)?.value;

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

  /**
   * no-store is no longer on the whole /api/r/* prefix, because a rule there
   * beats a route handler's own header and it was silently overriding the photo
   * proxy's cache — making a browser re-fetch every face it had already seen.
   *
   * These pin the narrowing in both directions. Losing the first means a roster
   * becomes cacheable; losing the second means the photo header goes back to
   * doing nothing, which is exactly the kind of change that looks harmless.
   */
  it("keeps roster responses out of every cache", async () => {
    const rules = await config.headers!();
    for (const url of ["/r/abc123", "/t/abc123", "/api/r/abc123"]) {
      assert.match(
        headerOn(rules, url, "Cache-Control") ?? "",
        /no-store/,
        `${url} may be cached — it carries a roster or a token`,
      );
    }
  });

  it("lets the photo routes set their own cache header", async () => {
    const rules = await config.headers!();
    for (const url of ["/api/r/abc123/photo", "/api/photos"]) {
      assert.equal(
        headerOn(rules, url, "Cache-Control"),
        undefined,
        `${url} is overridden by a config rule, so its own header does nothing`,
      );
      // The two that are never negotiable, image or not.
      for (const key of REQUIRED) {
        assert.ok(headerOn(rules, url, key), `${url} is missing ${key}`);
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
