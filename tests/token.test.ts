import "./helpers";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkRequestAccess,
  generateToken,
  GRACE_DAYS,
} from "../src/lib/auth/token";

/**
 * The token resolver is one of the two places the plan calls out as expensive
 * to get wrong (section 6). checkRequestAccess is the pure half — every
 * accept/reject decision passes through it — so it is tested exhaustively here
 * without needing a database.
 */

const open = { status: "open", dueDate: "2026-08-10" };
const at = (iso: string) => new Date(iso);

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
    assert.deepEqual(checkRequestAccess(open, at("2026-08-05T10:00:00+05:30")), {
      ok: true,
    });
  });

  test("still opens late on the due date itself", () => {
    // The teacher filling it in at 11pm on the last day has met the deadline.
    assert.deepEqual(checkRequestAccess(open, at("2026-08-10T23:00:00+05:30")), {
      ok: true,
    });
  });

  test("still opens inside the grace period", () => {
    const withinGrace = at("2026-08-13T12:00:00+05:30");
    assert.deepEqual(checkRequestAccess(open, withinGrace), { ok: true });
  });

  test("expires after due date plus the grace days", () => {
    const past = new Date(
      at("2026-08-10T23:59:59+05:30").getTime() +
        (GRACE_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    assert.deepEqual(checkRequestAccess(open, past), {
      ok: false,
      reason: "expired",
    });
  });

  test("a closed request never opens, even before the due date", () => {
    assert.deepEqual(
      checkRequestAccess(
        { ...open, status: "closed" },
        at("2026-08-01T10:00:00+05:30"),
      ),
      { ok: false, reason: "closed" },
    );
  });

  test("an expired-status request never opens", () => {
    assert.deepEqual(
      checkRequestAccess(
        { ...open, status: "expired" },
        at("2026-08-01T10:00:00+05:30"),
      ),
      { ok: false, reason: "closed" },
    );
  });

  test("closed beats expired — status is checked first", () => {
    const longAfter = at("2027-01-01T00:00:00+05:30");
    assert.deepEqual(
      checkRequestAccess({ ...open, status: "closed" }, longAfter),
      { ok: false, reason: "closed" },
    );
  });

  test("accepts a Date due date as well as an ISO string", () => {
    assert.deepEqual(
      checkRequestAccess(
        { status: "open", dueDate: new Date("2026-08-10T23:59:59+05:30") },
        at("2026-08-09T10:00:00+05:30"),
      ),
      { ok: true },
    );
  });
});
