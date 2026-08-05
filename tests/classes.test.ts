import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  compareClassLabels,
  normaliseClassLabel,
  parseClassList,
} from "../src/lib/classes";

/**
 * class_label is what request creation filters the roster on, so a label that
 * differs by a space produces a request with an empty roster and no error.
 */

describe("normaliseClassLabel", () => {
  test("trims and collapses whitespace", () => {
    assert.equal(normaliseClassLabel("  12   Sci "), "12 Sci");
    assert.equal(normaliseClassLabel("6"), "6");
  });

  test("leaves case alone", () => {
    assert.equal(normaliseClassLabel("12 Sci"), "12 Sci");
  });
});

describe("parseClassList", () => {
  test("splits, normalises and de-duplicates", () => {
    assert.deepEqual(parseClassList("6, 7 ,  6 , 12  Sci"), ["6", "7", "12 Sci"]);
  });

  test("an empty string is an empty list, not ['']", () => {
    assert.deepEqual(parseClassList(""), []);
    assert.deepEqual(parseClassList(" , "), []);
  });
});

describe("compareClassLabels", () => {
  test("sorts numerically, so 6 comes before 10", () => {
    assert.deepEqual(
      ["10", "6", "12 Sci", "9", "12 Com"].sort(compareClassLabels),
      ["6", "9", "10", "12 Com", "12 Sci"],
    );
  });

  test("puts non-numeric labels last rather than dropping them", () => {
    assert.deepEqual(["Nursery", "6"].sort(compareClassLabels), ["6", "Nursery"]);
  });
});
