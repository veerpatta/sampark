import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TONE, toneOf } from "../src/components/admin/progress-tone";

/**
 * Which word goes with which state, and in which order the checks run.
 *
 * The order IS the content of toneOf, and every one of these cases is a
 * sentence the office reads about a colleague. Getting them the wrong way round
 * is not a cosmetic bug: it tells somebody to chase a teacher who has done
 * nothing wrong.
 */

const form = (over: Partial<Parameters<typeof toneOf>[0]> = {}) => ({
  done: false,
  sent: true,
  opened: true,
  overdue: false,
  answered: 0,
  ...over,
});

describe("toneOf", () => {
  it("calls a finished link complete, whatever else is true of it", () => {
    // An answered link that was somehow never ticked as sent is finished
    // either way, and there is nothing to do about it.
    assert.equal(toneOf(form({ done: true, sent: false, overdue: true })), "done");
  });

  it("blames the office, not the teacher, for a link never handed over", () => {
    assert.equal(toneOf(form({ sent: false, opened: false })), "unsent");
  });

  it("separates 'not opened' from 'not started'", () => {
    // THE DISTINCTION THIS FILE EXISTS FOR. A link sent and never opened means
    // a wrong number or a message buried under forty others — a phone call,
    // not a fourth reminder. Both used to render as "not started".
    assert.equal(toneOf(form({ opened: false })), "unopened");
    assert.equal(toneOf(form({ opened: true })), "waiting");
  });

  it("calls a link she has started but not finished in progress", () => {
    assert.equal(toneOf(form({ answered: 4 })), "progress");
  });

  it("lets overdue outrank both, once it really is late", () => {
    assert.equal(toneOf(form({ overdue: true, opened: false })), "overdue");
    assert.equal(toneOf(form({ overdue: true, answered: 4 })), "overdue");
  });

  it("gives every state a word, never a colour alone", () => {
    // Read on a phone in a corridor between periods. Somebody who cannot
    // separate the amber from the red still has to know who to chase.
    for (const [state, tone] of Object.entries(TONE)) {
      assert.ok(tone.label.length > 0, `${state} has no word`);
      assert.ok(tone.pill.length > 0, `${state} has no pill`);
      assert.ok(tone.bar.length > 0, `${state} has no bar`);
    }
  });

  it("does not give two states the same word", () => {
    const labels = Object.values(TONE).map((tone) => tone.label);
    assert.equal(new Set(labels).size, labels.length);
  });
});
