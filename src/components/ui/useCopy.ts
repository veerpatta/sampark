"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Copy something, and say so for two seconds.
 *
 * Three components had written this by hand — the share panel, the teacher link
 * panel, and now the list of children still to fill in — each with the same
 * try/catch, the same 2000ms reset, and the same flag. Three copies of five lines
 * is not a crisis, but the third one is the point at which the reset timing and
 * the failure behaviour start drifting apart for no reason.
 *
 * A REFUSAL IS SWALLOWED ON PURPOSE, which is the behaviour all three already
 * had. Clipboard access can be denied by the browser or the platform, and in
 * every one of these places the text is on screen and selectable — so there is
 * nothing to recover from and nothing worth interrupting the office about.
 *
 * `key` names WHICH thing was copied, for a panel with more than one button; a
 * component with a single button can ignore it and read `copied`.
 */
export function useCopy(resetMs = 2000) {
  const [key, setKey] = useState<string | null>(null);
  /** Cleared on each copy so two quick taps do not race their own resets. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string, which = "default") => {
      try {
        await navigator.clipboard.writeText(text);
        setKey(which);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setKey(null), resetMs);
      } catch {
        // See above: the text is on screen and selectable.
      }
    },
    [resetMs],
  );

  return { copy, copied: key !== null, copiedKey: key };
}
