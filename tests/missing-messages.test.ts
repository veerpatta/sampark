import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGroupMissingMessage,
  buildRoundMissingMessage,
  buildRoundStatusMessage,
} from "../src/lib/whatsapp";

/**
 * The three messages that say who is still remaining.
 *
 * THEY EXIST BECAUSE wa.me CANNOT OPEN A GROUP CHAT. Every other send in this
 * app is a click-to-chat link carrying a number, because that is what puts the
 * message in front of the right person. WhatsApp exposes no equivalent URL for
 * a group, so the moment the destination is the staff group or a class group
 * the clipboard is the only mechanism there is — which is why these three are
 * built to be copied and never to be opened.
 *
 * The rule with teeth is the last assertion in each block: NONE of them may
 * carry a /r/ token. They are written to be forwarded, and a request token
 * opens that group's whole roster to whoever holds it.
 */

const CHILDREN = [
  { rollNo: 12, name: "ANSHUL KUMAWAT" },
  { rollNo: 19, name: "Bhavna Gurjar" },
  { rollNo: null, name: "CHETAN LOHAR" },
];

describe("buildRoundStatusMessage keeps its old shape", () => {
  const pending = {
    submitted: 8,
    total: 11,
    outstanding: [
      { label: "Class 7", answered: 0, rosterSize: 41 },
      { label: "Class 9 B", answered: 20, rosterSize: 24 },
    ],
  };

  it("is byte-identical when the round-scoped fields are absent", () => {
    // The dashboard's Share button spans every open round at once and so has
    // no single title or deadline to name. That call site must not change
    // shape merely because the round page wanted a heading.
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

  it("carries no due date under 'everything is in'", () => {
    // A deadline announced beside "nothing left to do" is a date nobody has to
    // act on.
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

describe("buildGroupMissingMessage", () => {
  const input = {
    audience: { kind: "class", label: "Class 8" },
    title: "Student photos",
    dueDate: "2026-08-20",
    answered: 21,
    rosterSize: 24,
    students: CHILDREN,
  };

  it("leads with the group and the round, in both languages", () => {
    const message = buildGroupMissingMessage(input);
    assert.match(
      message,
      /^Class 8 — Student photos\nकक्षा Class 8 — Student photos/,
    );
  });

  it("says how far along she is before saying who is left", () => {
    // "Still pending" and "21 of 24 done" are different facts, and a teacher
    // who has done twenty-one of twenty-four should not be told the first.
    const message = buildGroupMissingMessage(input);
    assert.match(message, /21 of 24 done\. These 3 are still to come:/);
    assert.match(message, /24 में से 21 हो गए। ये 3 अभी बाकी हैं:/);
  });

  it("title-cases the names the fee app stored in capitals", () => {
    // 483 of 504 names are ALL CAPS on disk. titleCaseName runs at render
    // everywhere else in the app, and a WhatsApp message is render — without
    // it every one of these lists arrives on a phone shouting.
    const message = buildGroupMissingMessage(input);
    assert.match(message, /• 12 · Anshul Kumawat/);
    assert.ok(!message.includes("ANSHUL KUMAWAT"), "the message shouted");
  });

  it("leaves a deliberately lower-case name alone", () => {
    assert.match(buildGroupMissingMessage(input), /• 19 · Bhavna Gurjar/);
  });

  it("gives a child with no roll number the name alone", () => {
    // Most children on the real roster have no roll number at all, so this is
    // the common case rather than the edge one. "• · Chetan Lohar" reads as a
    // bug in the app.
    const message = buildGroupMissingMessage(input);
    assert.match(message, /• Chetan Lohar/);
    assert.doesNotMatch(message, /• · /);
  });

  it("says 'not started' rather than '0 of 24 done'", () => {
    const message = buildGroupMissingMessage({ ...input, answered: 0 });
    assert.match(message, /Not started\. All 3 are still to come:/);
    assert.match(message, /अभी शुरू नहीं। सभी 3 बाकी हैं:/);
  });

  it("agrees with itself for a single child", () => {
    const message = buildGroupMissingMessage({
      ...input,
      students: [CHILDREN[1]!],
    });
    assert.match(message, /This one is still to come:/);
    assert.match(message, /यह एक अभी बाकी है:/);
  });

  it("carries NO link, even though it names one group", () => {
    // It is written to be forwarded — to her, or into her class group — and a
    // request token opens that class roster to whoever holds it.
    assert.doesNotMatch(buildGroupMissingMessage(input), /\/r\//);
  });

  it("keeps Devanagari numerals out, like every other message", () => {
    assert.doesNotMatch(buildGroupMissingMessage(input), /[०-९]/);
  });
});

describe("buildRoundMissingMessage", () => {
  const started = {
    audience: { kind: "class", label: "Class 8" },
    answered: 21,
    rosterSize: 24,
    students: CHILDREN,
  };
  const untouched = {
    audience: { kind: "class", label: "Class 10" },
    answered: 0,
    rosterSize: 31,
    students: Array.from({ length: 31 }, (_, i) => ({
      rollNo: i + 1,
      name: `CHILD ${i + 1}`,
    })),
  };
  const input = {
    title: "Student photos",
    dueDate: "2026-08-20",
    groups: [started, untouched],
  };

  it("counts every missing child in the headline, named or not", () => {
    const message = buildRoundMissingMessage(input);
    assert.match(message, /34 of 55 still to come, across 2 groups\./);
    assert.match(message, /55 में से 34 अभी बाकी हैं — 2 समूहों में।/);
  });

  it("names the children of a group that is under way", () => {
    const message = buildRoundMissingMessage(input);
    assert.match(message, /Class 8 — 3 left of 24 · 24 में से 3 बाकी/);
    assert.match(message, /• 12 · Anshul Kumawat/);
  });

  it("gives a group nobody has touched its count and no names", () => {
    // Thirty-one names in front of a teacher who has not opened the link say
    // nothing the count did not, and they are what turn this into a wall.
    const message = buildRoundMissingMessage(input);
    assert.match(
      message,
      /Class 10 — not started, all 31 · अभी शुरू नहीं, सभी 31/,
    );
    assert.doesNotMatch(message, /Child 1\b/);
  });

  it("falls back to a count when a started group has too many left", () => {
    const many = {
      audience: { kind: "class", label: "Class 9" },
      answered: 4,
      rosterSize: 46,
      students: Array.from({ length: 42 }, (_, i) => ({
        rollNo: i + 1,
        name: `PUPIL ${i + 1}`,
      })),
    };
    const message = buildRoundMissingMessage({ ...input, groups: [many] });
    assert.match(message, /Class 9 — 42 left of 46/);
    assert.doesNotMatch(message, /Pupil 1\b/);
  });

  it("keeps the order it was given — the caller has already sorted", () => {
    const message = buildRoundMissingMessage(input);
    assert.ok(message.indexOf("Class 8") < message.indexOf("Class 10"));
  });

  it("carries NO link — this one goes to the whole staff group", () => {
    assert.doesNotMatch(buildRoundMissingMessage(input), /\/r\//);
  });

  it("keeps Devanagari numerals out, like every other message", () => {
    assert.doesNotMatch(buildRoundMissingMessage(input), /[०-९]/);
  });
});
