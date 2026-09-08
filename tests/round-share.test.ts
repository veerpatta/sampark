import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRoundPendingMessage,
  buildRoundStatusMessage,
} from "../src/lib/whatsapp";
import { MAX_NAMED_TOTAL, type PendingStudent } from "../src/lib/pending";

/**
 * The two messages a round can post to a ROOM.
 *
 * Every other handover in this app is a wa.me link, because that carries the
 * number and opens on one conversation. These two are different: they are
 * addressed to the staff group or a class group, WhatsApp has no click-to-chat
 * URL for a group at all, and so they exist to be copied.
 *
 * The rule with teeth is the last assertion in each block: NEITHER may ever
 * carry a /r/ token. Both are built to be forwarded, and a request link opens
 * that group's whole roster to whoever ends up holding it.
 */

const child = (
  rollNo: number | null,
  name: string,
): PendingStudent => ({
  studentId: `S${rollNo ?? 0}`,
  rollNo,
  name,
  classLabel: "Class 8",
});

describe("buildRoundStatusMessage, round-scoped", () => {
  const pending = {
    submitted: 8,
    total: 11,
    outstanding: [
      { label: "Class 7", answered: 0, rosterSize: 41 },
      { label: "Class 9 B", answered: 20, rosterSize: 24 },
    ],
  };

  it("is byte-identical when the round-scoped fields are absent", () => {
    // The dashboard's Share spans every open round at once and can name no
    // single title or deadline. That call site must not change shape merely
    // because the round page wanted a heading.
    const before = [
      `8 of 11 groups have submitted.`,
      `11 में से 8 पूरी हो चुकी हैं।`,
      ``,
      `Still pending:`,
      `अभी बाकी:`,
      ``,
      `• Class 7 — not started · अभी शुरू नहीं`,
      `• Class 9 B — 20 of 24 · 24 में से 20`,
      ``,
      `— Veer Patta School office · वीर पत्ता विद्यालय कार्यालय`,
    ].join("\n");
    assert.equal(buildRoundStatusMessage(pending), before);
  });

  it("names the round and its deadline when it is about one round", () => {
    const message = buildRoundStatusMessage({
      ...pending,
      title: "Student photos",
      dueDate: "2026-08-20",
    });
    assert.match(message, /^Student photos\n\n8 of 11 groups have submitted\./);
    assert.match(message, /Due: 20 Aug · अंतिम तिथि: 20 Aug/);
  });

  it("carries no deadline under 'everything is in'", () => {
    // A date beside "nothing left to do" is a date nobody has to act on.
    const message = buildRoundStatusMessage({
      submitted: 11,
      total: 11,
      outstanding: [],
      title: "Student photos",
      dueDate: "2026-08-20",
    });
    assert.doesNotMatch(message, /Due:/);
  });

  it("carries no link — it is built to be pasted into a group", () => {
    assert.doesNotMatch(
      buildRoundStatusMessage({ ...pending, title: "Student photos" }),
      /\/r\//,
    );
  });
});

describe("buildRoundPendingMessage", () => {
  const started = {
    label: "Class 8",
    answered: 21,
    rosterSize: 24,
    pending: [child(12, "Anshul Kumawat"), child(19, "Bhavna Gurjar"), child(null, "Chetan Lohar")],
  };
  const untouched = {
    label: "Class 10",
    answered: 0,
    rosterSize: 31,
    // Over NAME_LIST_CEILING is not the only way to get null; pendingForBoard
    // hands null for anything not worth naming, and the builder must respect it.
    pending: null,
  };
  const input = {
    title: "Student photos",
    dueDate: "2026-08-20",
    groups: [started, untouched],
  };

  it("counts every outstanding child in the headline, named or not", () => {
    const message = buildRoundPendingMessage(input);
    assert.match(message, /34 of 55 still to come, across 2 groups\./);
    assert.match(message, /55 में से 34 अभी बाकी हैं — 2 समूहों में।/);
  });

  it("names the children of a group that is under way", () => {
    const message = buildRoundPendingMessage(input);
    assert.match(message, /Class 8 — 3 left of 24 · 24 में से 3 बाकी/);
    assert.match(message, /• 12\. Anshul Kumawat/);
  });

  it("gives a child with no roll number the name alone", () => {
    // Most children on the real roster have no roll number, so this is the
    // ordinary case. A leading separator would read as a bug.
    const message = buildRoundPendingMessage(input);
    assert.match(message, /• Chetan Lohar/);
    assert.doesNotMatch(message, /• \. /);
  });

  it("gives a group with no usable list its count and no names", () => {
    const message = buildRoundPendingMessage(input);
    assert.match(
      message,
      /Class 10 — not started, all 31 · अभी शुरू नहीं, सभी 31/,
    );
  });

  it("spends the name budget whole groups at a time", () => {
    // namesFor's rule, and the reason this builder does not do its own
    // accounting: a group that does not fit drops to a count rather than
    // showing an arbitrary slice of a longer list.
    const big = (label: string, n: number) => ({
      label,
      answered: 1,
      rosterSize: n + 1,
      pending: Array.from({ length: n }, (_, i) => child(i + 1, `Pupil ${i + 1}`)),
    });
    const message = buildRoundPendingMessage({
      ...input,
      groups: [big("Class 6", 25), big("Class 7", 25)],
    });
    // 25 fits the 40 budget; the second 25 does not, so it takes none.
    assert.ok(MAX_NAMED_TOTAL === 40);
    assert.match(message, /Class 6 — 25 left of 26/);
    assert.match(message, /Class 7 — 25 left of 26/);
    const named = [...message.matchAll(/• \d+\. Pupil/g)].length;
    assert.equal(named, 25, "the budget was spent per name, not per group");
  });

  it("keeps the order it was given — the caller has already sorted", () => {
    const message = buildRoundPendingMessage(input);
    assert.ok(message.indexOf("Class 8") < message.indexOf("Class 10"));
  });

  it("carries NO link — this one goes to the whole staff group", () => {
    assert.doesNotMatch(buildRoundPendingMessage(input), /\/r\//);
  });

  it("keeps Devanagari numerals out, like every other message", () => {
    assert.doesNotMatch(buildRoundPendingMessage(input), /[०-९]/);
  });
});
