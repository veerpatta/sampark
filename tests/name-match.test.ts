import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  matchName,
  normaliseName,
  similarity,
  type Candidate,
} from "../src/lib/name-match";

/**
 * The matcher exists so a file with no student ID can still be useful without
 * breaking "never match on name". What keeps it safe is not the scoring — it is
 * that a match is only ever a PROPOSAL, that candidates are scoped to one
 * class, and that more than one candidate is a refusal rather than a coin toss.
 *
 * These tests are about the refusals as much as the matches.
 *
 * Every name here is invented. Rule 12: the repo is public.
 */

const roster = (...names: string[]): Candidate[] =>
  names.map((name, index) => ({
    studentId: `ZZ${index}`,
    name,
    source: "test",
  }));

describe("normaliseName", () => {
  test("uppercases, strips punctuation, collapses spaces", () => {
    assert.equal(normaliseName("  aaaa   b.bbb  "), "AAAA B BBB");
  });
});

describe("tier 1 — exact", () => {
  test("matches regardless of case and spacing", () => {
    const result = matchName("aaaa bbbb", roster("AAAA  BBBB", "CCCC DDDD"));
    assert.equal(result.kind, "matched");
    assert.equal(result.kind === "matched" && result.tier, 1);
  });

  test("two identical names in one class is a refusal, not a guess", () => {
    // Two children in a village school share a name more often than you think.
    const result = matchName("aaaa bbbb", roster("AAAA BBBB", "AAAA BBBB"));
    assert.equal(result.kind, "ambiguous");
    assert.equal(result.kind === "ambiguous" && result.candidates.length, 2);
  });
});

describe("tier 2 — token subset", () => {
  test("a dropped middle name still matches", () => {
    const result = matchName("Aaaa Kkkk Cccc", roster("AAAA KKKK", "XXXX YYYY"));
    assert.equal(result.kind, "matched");
    assert.equal(result.kind === "matched" && result.tier, 2);
  });

  test("and the other direction", () => {
    const result = matchName("Aaaa Cccc", roster("AAAA KKKK CCCC", "XXXX YYYY"));
    assert.equal(result.kind, "matched");
    assert.equal(result.kind === "matched" && result.tier, 2);
  });

  test("two candidates both containing the name is a refusal", () => {
    const result = matchName("Aaaa", roster("AAAA BBBB", "AAAA CCCC"));
    assert.equal(result.kind, "ambiguous");
  });

  test("an exact match is never overridden by a subset match", () => {
    const result = matchName("Aaaa Bbbb", roster("AAAA BBBB", "AAAA BBBB CCCC"));
    assert.equal(result.kind === "matched" && result.tier, 1);
  });
});

describe("tier 3 — fuzzy", () => {
  test("catches a one-letter misspelling per word", () => {
    // The real shape of the problem: the same child typed twice by two people.
    const result = matchName("Namrata Kanwar Chouhan", roster("NAMRTA KUNWAR CHOUHAN"));
    assert.equal(result.kind, "matched");
    assert.equal(result.kind === "matched" && result.tier, 3);
  });

  test("catches a vowel swap in a surname", () => {
    const result = matchName("Akshita Gautam", roster("AKSHITA GOUTAM"));
    assert.equal(result.kind, "matched");
    assert.equal(result.kind === "matched" && result.tier, 3);
  });

  test("does NOT match two different children with a shared surname", () => {
    // This is the failure that would matter. Same surname, different first
    // name — a metric that called these one child would merge two records.
    const result = matchName("Rahul Sharma", roster("Rohit Sharma"));
    assert.equal(result.kind, "none");
  });

  test("two near-identical scores are a refusal", () => {
    const result = matchName("Aaaaaan Bbbb", roster("AAAAAAM BBBB", "AAAAAAP BBBB"));
    assert.equal(result.kind, "ambiguous");
  });
});

describe("tier 4 — no candidate", () => {
  test("an empty class matches nothing rather than reaching wider", () => {
    // Class scoping is what keeps the whole thing safe. An empty roster must
    // never fall back to searching the school.
    assert.equal(matchName("Aaaa Bbbb", []).kind, "none");
  });

  test("an unrelated name finds nothing", () => {
    assert.equal(matchName("Aaaa Bbbb", roster("XXXX YYYY")).kind, "none");
  });
});

describe("similarity", () => {
  test("identical is 1", () => {
    assert.equal(similarity("AAAA", "AAAA"), 1);
  });

  test("word-wise scoring beats whole-string for per-word typos", () => {
    // Six-letter word, one letter different. Bigram overlap alone scores this
    // 0.6; as a fraction of the word it is 0.83, which is what it actually is.
    assert.ok(similarity("KANWAR", "KUNWAR") > 0.8);
  });

  test("a genuinely different name scores low", () => {
    assert.ok(similarity("RAHUL SHARMA", "ROHIT SHARMA") < 0.82);
  });
});
