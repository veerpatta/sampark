import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_NAMED_INLINE,
  MAX_NAMED_PENDING,
  MAX_NAMED_TOTAL,
  NAME_LIST_CEILING,
  comparePending,
  namesFor,
  type PendingStudent,
} from "../src/lib/pending";

/**
 * Which children a reminder is allowed to name, and in what order.
 *
 * The rule that matters most here is the one the two caps only make sense
 * together: the budget is spent WHOLE ITEMS at a time. Spending it per name
 * quietly reintroduces the arbitrary-subset case NAME_LIST_CEILING exists to
 * prevent, from the other direction.
 */

function child(over: Partial<PendingStudent> = {}): PendingStudent {
  return {
    studentId: "S1",
    rollNo: 1,
    name: "Anita Kumari",
    classLabel: "Class 8",
    ...over,
  };
}

function many(n: number): PendingStudent[] {
  return Array.from({ length: n }, (_, i) =>
    child({ studentId: `S${i + 1}`, rollNo: i + 1, name: `Child ${i + 1}` }),
  );
}

describe("namesFor", () => {
  it("names a short list in full", () => {
    const list = many(4);
    assert.deepEqual(namesFor(4, list, MAX_NAMED_TOTAL), list);
  });

  it("truncates at the cap and leaves the remainder to the caller", () => {
    const named = namesFor(40, many(40), MAX_NAMED_TOTAL);
    assert.equal(named?.length, MAX_NAMED_PENDING);
  });

  it("refuses to name anything past the ceiling", () => {
    // Twenty-five arbitrary names out of two hundred is not something she can
    // act on, and it is a wall she scrolls past to reach the URL.
    const over = NAME_LIST_CEILING + 1;
    assert.equal(namesFor(over, many(over), MAX_NAMED_TOTAL), null);
  });

  it("names right up to the ceiling", () => {
    // The boundary is inclusive, so a class sitting exactly on it is still named
    // rather than silently becoming a bare count.
    assert.notEqual(
      namesFor(NAME_LIST_CEILING, many(NAME_LIST_CEILING), MAX_NAMED_TOTAL),
      null,
    );
  });

  it("says nothing when the caller never looked", () => {
    assert.equal(namesFor(4, null, MAX_NAMED_TOTAL), null);
  });

  it("says nothing when nobody is left", () => {
    assert.equal(namesFor(0, [], MAX_NAMED_TOTAL), null);
  });

  /**
   * THE RULE THE TWO CAPS ONLY MAKE SENSE TOGETHER.
   *
   * A per-name budget would hand this item fifteen of its fifty-five names —
   * an arbitrary subset, which is exactly what the ceiling exists to prevent.
   * Whole items or nothing.
   */
  it("drops an item to a count rather than naming part of it", () => {
    assert.equal(namesFor(55, many(55), 15), null);
  });

  it("still names an item that fits the remaining budget exactly", () => {
    const named = namesFor(15, many(15), 15);
    assert.equal(named?.length, 15);
  });

  it("takes a lower cap for the inline shape", () => {
    // The two shapes have different legibility limits: a vertical list of 25 is
    // scannable, the same 25 comma-joined is a paragraph. The caller passes the
    // cap so the renderer and the budget accounting cannot disagree about it.
    const named = namesFor(8, many(8), MAX_NAMED_TOTAL, MAX_NAMED_INLINE);
    assert.equal(named?.length, MAX_NAMED_INLINE);
  });

  it("keeps the inline cap well under the block cap", () => {
    // If these ever crossed, a reminder covering three lists would carry more
    // names per line than one covering a single list carries in total.
    assert.ok(MAX_NAMED_INLINE < MAX_NAMED_PENDING);
  });
});

describe("comparePending", () => {
  it("sorts by roll number, because that is the column she scans", () => {
    // NOT alphabetical. This list is checked against a physical register, and an
    // alphabetical list of four names means scanning the whole book four times.
    const sorted = [
      child({ rollNo: 31, name: "Anita" }),
      child({ rollNo: 12, name: "Vikram" }),
      child({ rollNo: 19, name: "Deepak" }),
    ].sort(comparePending);
    assert.deepEqual(
      sorted.map((s) => s.rollNo),
      [12, 19, 31],
    );
  });

  it("puts children with no roll number last, not first", () => {
    // Sorting a null as zero would file them above roll 1.
    const sorted = [
      child({ rollNo: null, name: "Zeenat" }),
      child({ rollNo: 5, name: "Anita" }),
    ].sort(comparePending);
    assert.deepEqual(
      sorted.map((s) => s.rollNo),
      [5, null],
    );
  });

  it("falls back to name order among children with no roll", () => {
    const sorted = [
      child({ rollNo: null, name: "Vikram Singh" }),
      child({ rollNo: null, name: "Anita Kumari" }),
    ].sort(comparePending);
    assert.deepEqual(
      sorted.map((s) => s.name),
      ["Anita Kumari", "Vikram Singh"],
    );
  });
});
