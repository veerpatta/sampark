import "./helpers";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkRequestAccess, generateToken } from "../src/lib/auth/token";

/**
 * The token resolver is one of the two places the plan calls out as expensive
 * to get wrong (section 6). checkRequestAccess is the pure half — every
 * accept/reject decision passes through it — so it is tested exhaustively here
 * without needing a database.
 */

const open = { status: "open", dueDate: "2026-08-10" };

describe("generateToken", () => {
  test("is 16 url-safe characters", () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(generateToken(), /^[A-Za-z0-9_-]{16}$/);
    }
  });

  test("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, generateToken));
    assert.equal(seen.size, 1000);
  });
});

describe("checkRequestAccess", () => {
  test("opens before the due date", () => {
    assert.deepEqual(checkRequestAccess(open), { ok: true });
  });

  test("the due date is metadata, not an access cutoff", () => {
    assert.deepEqual(
      checkRequestAccess({ status: "open", dueDate: "2000-01-01" }),
      { ok: true },
    );
  });

  test("also accepts a Date due date without treating it as an expiry", () => {
    assert.deepEqual(
      checkRequestAccess({ status: "open", dueDate: new Date("2000-01-01") }),
      { ok: true },
    );
  });

  test("a closed request never opens, even before the due date", () => {
    assert.deepEqual(
      checkRequestAccess({ ...open, status: "closed" }),
      { ok: false, reason: "closed" },
    );
  });

  test("an expired-status request never opens", () => {
    assert.deepEqual(
      checkRequestAccess({ ...open, status: "expired" }),
      { ok: false, reason: "closed" },
    );
  });

});
