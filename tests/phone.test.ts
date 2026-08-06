import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasPhone,
  isCompletePhone,
  normalisePhone,
  samePhone,
} from "../src/lib/phone";

/**
 * No real numbers here. 9876543210 is the number every Indian form example
 * uses and belongs to nobody — see tests/helpers.ts on why fixtures stay
 * synthetic in a public repo.
 */
const TEN = "9876543210";

describe("normalisePhone", () => {
  it("leaves a plain ten-digit number alone", () => {
    assert.equal(normalisePhone(TEN), TEN);
  });

  it("strips the spaces and dashes people actually type", () => {
    assert.equal(normalisePhone("98765 43210"), TEN);
    assert.equal(normalisePhone("98765-43210"), TEN);
    assert.equal(normalisePhone(" 9876543210 "), TEN);
  });

  it("drops a pasted +91", () => {
    assert.equal(normalisePhone("+91 98765 43210"), TEN);
    assert.equal(normalisePhone("919876543210"), TEN);
  });

  it("drops a leading trunk zero", () => {
    assert.equal(normalisePhone("09876543210"), TEN);
  });

  it("drops both when a number arrives fully decorated", () => {
    assert.equal(normalisePhone("+91 098765 43210"), TEN);
  });

  it("keeps a ten-digit number that merely starts with 91", () => {
    // Only strip when there are MORE digits than a number can hold. Otherwise
    // a real 91xxxxxxxx would lose its first two digits.
    assert.equal(normalisePhone("9111111111"), "9111111111");
  });

  it("keeps a ten-digit number that merely starts with 0", () => {
    assert.equal(normalisePhone("0111111111"), "0111111111");
  });

  it("caps anything longer at ten digits", () => {
    assert.equal(normalisePhone("98765432101234"), TEN);
  });

  it("treats null, undefined and rubbish as blank", () => {
    assert.equal(normalisePhone(null), "");
    assert.equal(normalisePhone(undefined), "");
    assert.equal(normalisePhone("not a number"), "");
  });
});

describe("isCompletePhone", () => {
  it("is true only at ten digits", () => {
    assert.equal(isCompletePhone(TEN), true);
    assert.equal(isCompletePhone("+91 98765 43210"), true);
    assert.equal(isCompletePhone("98765"), false);
    assert.equal(isCompletePhone(""), false);
  });
});

describe("hasPhone", () => {
  it("treats an empty or whitespace string as no number saved", () => {
    // teachers.phone is NOT NULL, so "missing" arrives as "" and not as null.
    assert.equal(hasPhone(""), false);
    assert.equal(hasPhone("   "), false);
    assert.equal(hasPhone(null), false);
    assert.equal(hasPhone(TEN), true);
  });
});

describe("samePhone", () => {
  it("compares the numbers, not the typing", () => {
    assert.equal(samePhone("+91 98765 43210", TEN), true);
    assert.equal(samePhone("09876543210", TEN), true);
    assert.equal(samePhone(TEN, "9876543211"), false);
  });
});
