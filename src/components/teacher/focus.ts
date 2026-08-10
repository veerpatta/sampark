"use client";

import { useEffect, useState } from "react";

/**
 * Where the caret goes next, and keeping it out from under the keyboard.
 *
 * TWO PROBLEMS, ONE CAUSE. A teacher works down a class of forty-six typing
 * one number per child. Every time she finished a box she had to dismiss the
 * keyboard, find the next child, and tap — and on a short phone the box she was
 * typing into was often behind the keyboard while she typed. Both are the same
 * thing: the screen was not following her.
 *
 * WHAT COUNTS AS "THE NEXT BOX" IS MARKED, NOT GUESSED. Every field she types
 * into carries `data-teacher-input`, so the walk cannot wander into the photo
 * field's file inputs — which are `sr-only`, so focusing one silently drops the
 * keyboard and looks like a freeze. That was already live: the old within-row
 * advance queried plain `input` and would land on one the moment a round asked
 * for a photograph as well as a number.
 */

/** Marks a control the caret is allowed to land on. Set by FieldInput. */
export const TEACHER_INPUT = "data-teacher-input";

/** Long enough for a phone's keyboard animation to finish moving things. */
const KEYBOARD_SETTLE_MS = 300;

/** Clear of the sticky progress rail at the bottom and the header at the top. */
const EDGE_MARGIN_PX = 96;

type Focusable = HTMLInputElement | HTMLSelectElement;

/** Every box she can type into, in the order they appear down the screen. */
export function teacherInputs(root: ParentNode = document): Focusable[] {
  return [...root.querySelectorAll<Focusable>(`[${TEACHER_INPUT}]`)].filter(
    (element) => !element.disabled && element.offsetParent !== null,
  );
}

/**
 * The next box after this one, anywhere on the page.
 *
 * Document order, so it runs to the end of this child's fields and then into
 * the next child's — which is what "next" means to someone working down a
 * list, and it needs no knowledge of where one card ends and another begins.
 */
export function nextInput(from: Element): Focusable | null {
  const all = teacherInputs();
  const index = all.indexOf(from as Focusable);
  if (index < 0) return null;
  return all[index + 1] ?? null;
}

/**
 * Move on: to the next box, or out of the last one.
 *
 * Blurring at the end is deliberate. It puts the keyboard away, which is the
 * signal that there is nothing more to type, and it fires the row's own blur
 * commit rather than leaving the last answer waiting on a timer.
 */
export function focusNext(from: Element): boolean {
  const next = nextInput(from);
  if (!next) {
    (from as HTMLElement).blur();
    return false;
  }
  next.focus();
  keepInView(next);
  return true;
}

/**
 * Scroll a field clear of the keyboard, if the keyboard is covering it.
 *
 * `visualViewport` is what actually knows: with `interactiveWidget:
 * resizes-content` set in the root layout, its height is the space left above
 * the keyboard. Falling back to a plain scroll where it is missing is fine —
 * that is an old browser, and centring the field is right there too.
 *
 * ONLY WHEN IT IS ACTUALLY OBSCURED. Scrolling a field that is already
 * comfortably in view moves the page under her thumb for no reason, which is
 * its own kind of broken.
 */
export function keepInView(element: Element): void {
  window.setTimeout(() => {
    if (!element.isConnected) return;

    const box = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport ? viewport.offsetTop : 0;
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;

    const hidden =
      box.bottom > bottom - EDGE_MARGIN_PX || box.top < top + EDGE_MARGIN_PX;
    if (!hidden) return;

    element.scrollIntoView({ block: "center", behavior: "smooth" });
  }, KEYBOARD_SETTLE_MS);
}

/**
 * Keep whatever she is typing into visible for as long as she is typing.
 *
 * The keyboard is not the only thing that moves the goalposts: it opens, it
 * changes height when she switches to the number pad, and the page reflows
 * under it whenever a row commits and collapses. One listener on the viewport
 * catches all of those, where a scroll fired once on focus catches only the
 * first.
 *
 * Returns its own teardown, for useEffect.
 */
export function watchKeyboard(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  const onResize = () => {
    const active = document.activeElement;
    // Only ever moves the page for a box she is in. Anything else scrolling
    // itself into view while she reads is the screen taking over.
    if (active instanceof HTMLElement && active.hasAttribute(TEACHER_INPUT)) {
      keepInView(active);
    }
  };

  viewport.addEventListener("resize", onResize);
  return () => viewport.removeEventListener("resize", onResize);
}

/**
 * Is she typing right now?
 *
 * WHICH IS THE SAME QUESTION AS "is the keyboard up", asked in the one way
 * that does not need a heuristic. Measuring the viewport does not work here:
 * the root layout sets `interactiveWidget: resizes-content`, so the layout
 * viewport shrinks WITH the visual one and the difference the usual trick
 * looks for is gone. Focus is the honest signal, and it is the thing actually
 * being asked about — the bottom rail is useless while a keyboard covers it.
 *
 * `focusin` and `focusout` rather than focus/blur: those do not bubble, and the
 * controls come and go as rows open and collapse under her.
 *
 * The viewport is watched as well, and not for belt and braces: a keyboard
 * opening, closing or changing height resizes it, and that catches the cases
 * focus alone does not — a phone that restores an already-focused field when
 * she comes back to the tab, or a browser that defers focus events while the
 * document is in the background. Both listeners ask the same question of the
 * same source of truth, so a duplicate answer costs one no-op setState.
 */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const check = () =>
      setTyping(
        document.activeElement instanceof HTMLElement &&
          document.activeElement.hasAttribute(TEACHER_INPUT),
      );

    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    window.visualViewport?.addEventListener("resize", check);
    check();
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, []);

  return typing;
}
