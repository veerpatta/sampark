import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TEACHER_INPUT, nextInput, teacherInputs } from "../src/components/teacher/focus";

/**
 * Which box the caret goes to next.
 *
 * The rule that matters is that the walk only ever lands on a box she can
 * actually type into. A photo field ships two `sr-only` file inputs, and the
 * old within-row advance queried plain `input` — so the moment a round asked
 * for a photograph as well as a number, "next" was an invisible control, the
 * keyboard dropped, and the screen looked frozen.
 *
 * These run against a hand-built DOM rather than a rendered component: the
 * question is about document order and what is skipped, and a fake DOM answers
 * it without a browser.
 */

type FakeElement = {
  tagName: string;
  disabled: boolean;
  offsetParent: object | null;
  attributes: Set<string>;
  hasAttribute(name: string): boolean;
};

const make = (
  tagName: string,
  options: { teacher?: boolean; disabled?: boolean; hidden?: boolean } = {},
): FakeElement => ({
  tagName,
  disabled: options.disabled ?? false,
  // jsdom-free stand-in for "is this on screen": a display:none control has a
  // null offsetParent, which is how teacherInputs refuses to focus one.
  offsetParent: options.hidden ? null : {},
  attributes: new Set(options.teacher ? [TEACHER_INPUT] : []),
  hasAttribute(name: string) {
    return this.attributes.has(name);
  },
});

/** A stand-in for the page: querySelectorAll returns what we put in it. */
function page(elements: FakeElement[]) {
  return {
    querySelectorAll: (selector: string) => {
      assert.equal(selector, `[${TEACHER_INPUT}]`, "the walk widened its query");
      return elements.filter((element) => element.hasAttribute(TEACHER_INPUT));
    },
  } as unknown as ParentNode;
}

describe("teacherInputs", () => {
  it("returns only the boxes she can type into, in order", () => {
    const phone = make("INPUT", { teacher: true });
    const father = make("INPUT", { teacher: true });
    const file = make("INPUT"); // the photo field's camera input
    const found = teacherInputs(page([phone, file, father]));
    assert.deepEqual(found, [phone, father]);
  });

  it("skips a control that is disabled or off screen", () => {
    const live = make("INPUT", { teacher: true });
    const off = make("INPUT", { teacher: true, hidden: true });
    const dead = make("INPUT", { teacher: true, disabled: true });
    assert.deepEqual(teacherInputs(page([live, off, dead])), [live]);
  });

  it("counts a select — a house dropdown is a box she answers in", () => {
    const select = make("SELECT", { teacher: true });
    assert.deepEqual(teacherInputs(page([select])), [select]);
  });
});

describe("nextInput", () => {
  /**
   * nextInput reads the live document, so these drive it through the same
   * `teacherInputs` by stubbing globalThis.document for the call.
   */
  let restore: PropertyDescriptor | undefined;

  beforeEach(() => {
    restore = Object.getOwnPropertyDescriptor(globalThis, "document");
  });

  const withPage = <T,>(elements: FakeElement[], run: () => T): T => {
    Object.defineProperty(globalThis, "document", {
      value: page(elements),
      configurable: true,
    });
    try {
      return run();
    } finally {
      if (restore) Object.defineProperty(globalThis, "document", restore);
      else delete (globalThis as { document?: unknown }).document;
    }
  };

  it("runs past the end of one child's fields into the next child's", () => {
    // Two children, two fields each. Document order is the whole rule — it
    // needs no idea where one card stops and the next starts.
    const a1 = make("INPUT", { teacher: true });
    const a2 = make("INPUT", { teacher: true });
    const b1 = make("INPUT", { teacher: true });
    withPage([a1, a2, b1], () => {
      assert.equal(nextInput(a1 as unknown as Element), a2);
      assert.equal(nextInput(a2 as unknown as Element), b1, "stopped at the card edge");
    });
  });

  it("steps over the photo field's file inputs", () => {
    const phone = make("INPUT", { teacher: true });
    const camera = make("INPUT");
    const gallery = make("INPUT");
    const nextChild = make("INPUT", { teacher: true });
    withPage([phone, camera, gallery, nextChild], () => {
      assert.equal(nextInput(phone as unknown as Element), nextChild);
    });
  });

  it("has nothing after the last box", () => {
    const only = make("INPUT", { teacher: true });
    withPage([only], () => {
      assert.equal(nextInput(only as unknown as Element), null);
    });
  });

  it("returns null for a control that is not part of the walk", () => {
    const stranger = make("INPUT");
    const real = make("INPUT", { teacher: true });
    withPage([real, stranger], () => {
      assert.equal(nextInput(stranger as unknown as Element), null);
    });
  });
});
