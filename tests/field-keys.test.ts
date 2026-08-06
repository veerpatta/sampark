import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFieldKey, slugFieldKey } from "../src/lib/field-keys";

/**
 * The key is a database identifier — the primary key of field_defs, referenced
 * by submissions, student_records and change_log, and never renamed once
 * anything points at it. So it is derived, not typed.
 */

describe("slugFieldKey", () => {
  const none = new Set<string>();

  it("turns a label into a legal key", () => {
    assert.equal(slugFieldKey("T-shirt size", none), "q_t_shirt_size");
    assert.ok(isFieldKey(slugFieldKey("T-shirt size", none)));
  });

  it("prefixes every question, so one can never claim a master column", () => {
    // A question called "Phone" becoming `phone` would point the answers at
    // students.phone through the existing registry row.
    assert.equal(slugFieldKey("Phone", none), "q_phone");
    assert.notEqual(slugFieldKey("Phone", none), "phone");
  });

  it("collapses punctuation and case rather than rejecting them", () => {
    assert.equal(slugFieldKey("  Trip   FEE (2026) ", none), "q_trip_fee_2026");
  });

  it("gives a repeat its own key instead of overwriting the first", () => {
    // Last year's T-shirt sizes and this year's are different questions, and
    // the first one's answers must stay attached to the first one.
    const taken = new Set(["q_t_shirt_size"]);
    assert.equal(slugFieldKey("T-shirt size", taken), "q_t_shirt_size_2");

    taken.add("q_t_shirt_size_2");
    assert.equal(slugFieldKey("T-shirt size", taken), "q_t_shirt_size_3");
  });

  it("stays inside the 40-character limit even when it has to add a suffix", () => {
    const long = "A very long question about something quite specific indeed";
    const key = slugFieldKey(long, none);
    assert.ok(key.length <= 40, key);
    assert.ok(isFieldKey(key));

    const suffixed = slugFieldKey(long, new Set([key]));
    assert.ok(suffixed.length <= 40, suffixed);
    assert.ok(isFieldKey(suffixed));
    assert.notEqual(suffixed, key);
  });

  it("refuses a label with no letters to work with", () => {
    // A Hindi-only label produces nothing here, which is why the English one is
    // required rather than optional.
    assert.throws(() => slugFieldKey("टी-शर्ट साइज़", none), /some letters/);
    assert.throws(() => slugFieldKey("   ", none), /some letters/);
    assert.throws(() => slugFieldKey("!!!", none), /some letters/);
  });
});

describe("isFieldKey", () => {
  it("matches the rule the registry already enforced", () => {
    assert.equal(isFieldKey("bank_account"), true);
    assert.equal(isFieldKey("Bank_Account"), false);
    assert.equal(isFieldKey("2fa"), false);
    assert.equal(isFieldKey("a"), false);
  });
});
