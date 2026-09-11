import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isStale,
  MASTER_QUEUE_CAP,
  MAX_AGE_MS,
  MIN_UPLOAD_INTERVAL_MS,
  oldestFirst,
  QUEUE_CAP,
  queueFull,
  queueKey,
  shouldDrain,
} from "../src/components/teacher/photo-queue";
import { LIMITS } from "../src/lib/ratelimit";

/**
 * The decisions the photo queue makes, without a browser.
 *
 * Everything asserted here is a pure function deliberately kept out of the
 * provider so it can be tested at all — the IndexedDB half cannot be, in node.
 */

describe("the queue cap", () => {
  it("holds a phone to twenty", () => {
    assert.equal(queueFull(19), false);
    assert.equal(queueFull(20), true);
    assert.equal(queueFull(21), true);
  });

  /*
   * TWENTY IS A KINDNESS ON A PHONE AND AN OBSTACLE ON A LAPTOP. The office
   * drops a folder of two hundred in one gesture; refusing at twenty turns that
   * into ten separate drops for no reason a person could work out.
   */
  it("lets the office queue a whole folder", () => {
    assert.equal(queueFull(250, MASTER_QUEUE_CAP), false);
    assert.equal(queueFull(MASTER_QUEUE_CAP, MASTER_QUEUE_CAP), true);
    assert.ok(MASTER_QUEUE_CAP > QUEUE_CAP);
  });
});

describe("the upload pace", () => {
  /*
   * The pace has to stay UNDER the server's own budget with room to spare, or
   * a big drop spends the whole minute's allowance and starts colliding with
   * its own retries — which is slower than pacing, as well as noisier.
   */
  it("stays comfortably inside the server's photo budget", () => {
    const perMinute = 60_000 / MIN_UPLOAD_INTERVAL_MS;
    assert.ok(
      perMinute < LIMITS.perPhotoToken.limit,
      `${perMinute}/min must be under ${LIMITS.perPhotoToken.limit}/min`,
    );
    assert.ok(perMinute >= 30, "but fast enough to be worth using");
  });

  it("never makes a teacher wait — she cannot shoot twice that fast", () => {
    assert.ok(MIN_UPLOAD_INTERVAL_MS <= 2_000);
  });
});

describe("the other decisions", () => {
  it("drains only when online, idle and holding something", () => {
    assert.equal(shouldDrain(true, false, 1), true);
    assert.equal(shouldDrain(false, false, 1), false, "offline");
    assert.equal(shouldDrain(true, true, 1), false, "already running");
    assert.equal(shouldDrain(true, false, 0), false, "nothing to send");
  });

  it("sends the oldest first", () => {
    const rows = [{ capturedAt: 3 }, { capturedAt: 1 }, { capturedAt: 2 }];
    assert.deepEqual(
      rows.slice().sort(oldestFirst).map((row) => row.capturedAt),
      [1, 2, 3],
    );
  });

  it("drops a photo from last term", () => {
    const now = Date.now();
    assert.equal(isStale({ capturedAt: now - MAX_AGE_MS - 1 }, now), true);
    assert.equal(isStale({ capturedAt: now - 1000 }, now), false);
  });

  it("keys a photo by link and child, so two links never share one", () => {
    assert.equal(queueKey("tokenA", "S1001"), "tokenA|S1001");
    assert.notEqual(queueKey("tokenA", "S1001"), queueKey("tokenB", "S1001"));
  });
});
