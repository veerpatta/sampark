import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchPages, MIN_QUERY, PAGES } from "../src/lib/search";

describe("matchPages", () => {
  it("needs two characters, then matches a screen by name or by what people call it", () => {
    assert.deepEqual(matchPages("r", true), []);
    assert.equal(MIN_QUERY, 2);
    assert.ok(matchPages("marks", false).some((hit) => hit.href === "/marks"));
    assert.ok(matchPages("heatmap", false).some((hit) => hit.href === "/students/health"));
    assert.ok(matchPages("APPROVE", false).some((hit) => hit.href === "/review"));
  });

  it("keeps the owner-only screens away from everyone else", () => {
    assert.equal(matchPages("audit", false).length, 0);
    assert.ok(matchPages("audit", true).some((hit) => hit.href === "/settings/audit"));
  });

  it("every page hit is a page, with a title and a path", () => {
    for (const page of PAGES) {
      const hits = matchPages(page.label, true);
      assert.ok(hits.some((hit) => hit.href === page.href && hit.kind === "page"), page.label);
    }
  });
});
