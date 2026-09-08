import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXCLUSIVE_CLASS_TAGS, TEST_CLASS } from "./fixtures";

/**
 * A drift guard, not a test of today's files.
 *
 * `node --test` runs test files in PARALLEL against ONE database. Each file
 * cleans up only its own rows — PREFIX carries the file's name — so the two
 * fixtures that build their own roster are safe by construction, and the
 * fan-out fixture is safe because it invents synthetic class labels.
 *
 * What is not safe is calling the real createRequest. That resolves the roster
 * from the CLASS, so it freezes every fixture child sharing that label across
 * the whole suite — including ones another file is deleting at that moment,
 * which fails the insert on a foreign key to a student that has just gone. It
 * read as a flaky test for a long time; it was a real one.
 *
 * So a file that resolves a roster by class needs a class nobody else uses, and
 * this is what makes that a rule rather than a thing somebody remembered once.
 * A sixth such file fails here, on a line that says what to do, instead of
 * failing somewhere else one run in five.
 */

const DIR = import.meta.dirname;

/**
 * The call that resolves a roster from a class label. createBatch is NOT here:
 * it takes an audience, and createFanOutScenario gives it synthetic per-scenario
 * labels, so a batch test can never see another file's children.
 */
const RESOLVES_BY_CLASS = /\bcreateRequest\s*\(/;

/** `review.test.ts` -> `REVIEWXXXX`. Mirrors FILE_TAG in fixtures.ts. */
function tagOf(file: string): string {
  return file
    .replace(/\.test\.ts$/, "")
    .replace(/[^a-z]/gi, "")
    .slice(0, 10)
    .toUpperCase()
    .padEnd(10, "X");
}

describe("test files that freeze a roster by class", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".test.ts"));

  it("finds the suite, so a bad glob cannot pass this vacuously", () => {
    assert.ok(files.length > 20, `only found ${files.length} test files`);
  });

  it("each have a class of their own", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(join(DIR, file), "utf8");
      return (
        RESOLVES_BY_CLASS.test(source) &&
        !EXCLUSIVE_CLASS_TAGS.includes(tagOf(file))
      );
    });

    assert.deepEqual(
      offenders,
      [],
      `${offenders.join(", ")} calls createRequest, which freezes every fixture ` +
        `child sharing its class label — including ones another test file is ` +
        `deleting at that moment. Give it its own label in EXCLUSIVE_CLASSES ` +
        `in tests/fixtures.ts.`,
    );
  });

  it("hands a reserved file a label of its own", () => {
    // This file is not reserved, so it must see the shared default — which is
    // also the proof that the lookup is keyed the way FILE_TAG computes.
    assert.equal(TEST_CLASS, "12 Commerce");
    assert.ok(EXCLUSIVE_CLASS_TAGS.includes("REVIEWXXXX"));
  });

  it("reserves a label no other file plants children in", () => {
    // Every fixture student is created in TEST_CLASS, so exclusivity holds as
    // long as a reserved label is never the shared default.
    assert.ok(!EXCLUSIVE_CLASS_TAGS.includes(tagOf("fixtures.test.ts")));
    assert.notEqual("12 Science", "12 Commerce");
  });
});
