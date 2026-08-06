import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CLASS_LABELS,
  compareClassLabels,
  compareStudentNames,
  isClassLabel,
  normaliseClassLabel,
  parseClassList,
  titleCaseName,
} from "../src/lib/classes";

/**
 * class_label is what request creation filters the roster on, so a label that
 * differs by a space — or by convention — produces a request with an empty
 * roster and no error. These labels come from the fee app, which is the source
 * of truth, and the two systems join on them.
 */

describe("CLASS_LABELS", () => {
  test("is the nineteen the fee app uses, spelled exactly", () => {
    assert.deepEqual(CLASS_LABELS.slice(0, 3), ["Nursery", "JKG", "SKG"]);
    assert.equal(CLASS_LABELS.length, 19);
    assert.ok(CLASS_LABELS.includes("Class 10"));
    assert.ok(CLASS_LABELS.includes("11 Commerce"));
    assert.ok(CLASS_LABELS.includes("12 Science"));
  });

  test("rejects the conventions the code used to assume", () => {
    // The old convention: '6', '10 A', '12 Sci'. Every one of these would have
    // matched no student at all.
    assert.equal(isClassLabel("6"), false);
    assert.equal(isClassLabel("12 Sci"), false);
    assert.equal(isClassLabel("10 A"), false);
    assert.equal(isClassLabel("Class 6"), true);
  });

  test("is case-sensitive — the join is on the exact string", () => {
    assert.equal(isClassLabel("class 6"), false);
    assert.equal(isClassLabel("NURSERY"), false);
  });
});

describe("normaliseClassLabel", () => {
  test("trims and collapses whitespace", () => {
    assert.equal(normaliseClassLabel("  Class   6 "), "Class 6");
    assert.equal(normaliseClassLabel("Nursery"), "Nursery");
  });

  test("a trailing space would otherwise empty a roster silently", () => {
    assert.equal(isClassLabel("Class 8 "), false);
    assert.equal(isClassLabel(normaliseClassLabel("Class 8 ")), true);
  });
});

describe("parseClassList", () => {
  test("splits, normalises and de-duplicates", () => {
    assert.deepEqual(parseClassList("Class 6, Class 7 ,  Class 6 , 12  Arts"), [
      "Class 6",
      "Class 7",
      "12 Arts",
    ]);
  });

  test("an empty string is an empty list, not ['']", () => {
    assert.deepEqual(parseClassList(""), []);
    assert.deepEqual(parseClassList(" , "), []);
  });
});

describe("compareClassLabels", () => {
  test("sorts the way a timetable reads, pre-school first", () => {
    assert.deepEqual(
      ["Class 10", "Nursery", "Class 6", "SKG", "JKG", "Class 1"].sort(
        compareClassLabels,
      ),
      ["Nursery", "JKG", "SKG", "Class 1", "Class 6", "Class 10"],
    );
  });

  test("Class 6 comes before Class 10, not after", () => {
    assert.deepEqual(["Class 10", "Class 6"].sort(compareClassLabels), [
      "Class 6",
      "Class 10",
    ]);
  });

  test("streams sort within their year", () => {
    assert.deepEqual(
      ["12 Science", "11 Science", "12 Arts", "11 Arts", "11 Commerce"].sort(
        compareClassLabels,
      ),
      ["11 Arts", "11 Commerce", "11 Science", "12 Arts", "12 Science"],
    );
  });

  test("senior classes come after Class 10", () => {
    assert.deepEqual(["11 Arts", "Class 10"].sort(compareClassLabels), [
      "Class 10",
      "11 Arts",
    ]);
  });

  test("an unknown label sorts last rather than being dropped", () => {
    assert.deepEqual(["Class 12 B", "Nursery"].sort(compareClassLabels), [
      "Nursery",
      "Class 12 B",
    ]);
  });
});

describe("titleCaseName", () => {
  test("an ALL CAPS name becomes title case", () => {
    // Invented names. Rule 12: no real student appears in a test.
    assert.equal(titleCaseName("AAAAA BBBBB"), "Aaaaa Bbbbb");
    assert.equal(titleCaseName("XX YY ZZ"), "Xx Yy Zz");
  });

  test("a name already typed properly is left completely alone", () => {
    assert.equal(titleCaseName("Aaaaa deBbbbb"), "Aaaaa deBbbbb");
  });

  test("survives punctuation and initials", () => {
    assert.equal(titleCaseName("AAAA S/O BBBB"), "Aaaa S/O Bbbb");
    assert.equal(titleCaseName(""), "");
  });
});

describe("compareStudentNames", () => {
  test("orders by name regardless of how the name was capitalised", () => {
    assert.deepEqual(
      ["CCCCC", "Aaaaa", "BBBBB"].sort(compareStudentNames),
      ["Aaaaa", "BBBBB", "CCCCC"],
    );
  });
});
