"use client";

import { useState } from "react";
import { btn } from "@/components/ui/controls";

/**
 * Copy a block of text to the clipboard.
 *
 * WHY THIS IS THE PRIMARY CONTROL AND NOT A FALLBACK. Every other send in this
 * app is a wa.me link, because wa.me carries the number and opens on that one
 * conversation — see components/ui/share.ts for the bug that caused when it was
 * a share sheet instead. But wa.me addresses a PERSON. It cannot open a group
 * chat, and no amount of dressing up will make it: WhatsApp exposes no
 * click-to-chat URL for a group. So the moment the destination is the staff
 * group or a class group, the clipboard is not a workaround — it is the only
 * mechanism there is, and the office's instinct to copy the message was right.
 *
 * TWO INLINE COPIES OF THIS ALREADY EXISTED, in the share panel and in the
 * teacher link panel, and both carried the same latent bug: they call
 * `navigator.clipboard.writeText` inside a try/catch with an empty catch, and
 * `navigator.clipboard` is UNDEFINED on an insecure origin. On plain http the
 * property access throws, the catch swallows it, and the button does nothing at
 * all, for ever, with nothing on screen to say why. The `failed` state below is
 * that bug fixed; the silent catch is kept only for a genuine refusal, where
 * the text really is on screen and selectable.
 *
 * NO TOAST. The house rule (components/ui/Toast.tsx) is that a toast replaces a
 * confirmation dialog — it exists to say what was just done to the data. A
 * label swapping to "Copied" is the lighter answer and is already what the two
 * screens this replaces did. It is wrapped in aria-live so the swap is not
 * invisible to a screen reader, which is the one thing they both got wrong.
 */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  tone,
  className = "",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  tone?: "primary" | "go" | "quiet";
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      // Either no clipboard API (insecure origin) or the user refused it. The
      // text is on screen and selectable either way, so say so rather than
      // leaving a button that looks broken.
      setState("failed");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className={`${btn({ tone })} px-3 ${className}`}
      >
        <span aria-live="polite">
          {state === "copied" ? copiedLabel : label}
        </span>
      </button>
      {state === "failed" ? (
        <span className="text-xs text-[var(--color-danger)]">
          Could not copy — select the text and copy it by hand.
        </span>
      ) : null}
    </span>
  );
}
