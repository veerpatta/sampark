import "../drizzle/env";
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { LIMITS, clientIp, limitByToken } from "../src/lib/ratelimit";

/**
 * The limiter counts in Postgres, not in memory, so this has to hit the real
 * database — an in-memory version would pass a test and still fail in
 * production, where every serverless instance keeps its own private tally.
 */

after(async () => {
  await db.execute(sql`DELETE FROM rate_limits WHERE bucket LIKE 'token:ZZTEST%'`);
});

describe("limitByToken", () => {
  test("allows up to the limit, then refuses", async () => {
    const token = `ZZTEST${Date.now()}`;

    for (let i = 1; i <= LIMITS.perToken.limit; i += 1) {
      const result = await limitByToken(token);
      assert.equal(result.ok, true, `request ${i} should be allowed`);
    }

    const over = await limitByToken(token);
    assert.equal(over.ok, false, "one past the limit must be refused");
    assert.equal(over.remaining, 0);
    assert.ok(
      over.retryAfterSeconds > 0 && over.retryAfterSeconds <= 60,
      `retry-after should be within the window, got ${over.retryAfterSeconds}`,
    );
  });

  test("counts each token separately", async () => {
    const a = `ZZTESTa${Date.now()}`;
    const b = `ZZTESTb${Date.now()}`;

    for (let i = 0; i < LIMITS.perToken.limit + 1; i += 1) await limitByToken(a);

    assert.equal((await limitByToken(a)).ok, false);
    assert.equal(
      (await limitByToken(b)).ok,
      true,
      "one teacher hitting the limit must not lock out another",
    );
  });
});

describe("clientIp", () => {
  test("takes the first entry of x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    assert.equal(clientIp(headers), "1.2.3.4");
  });

  test("falls back to x-real-ip, then to a placeholder", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
    assert.equal(clientIp(new Headers()), "unknown");
  });
});
