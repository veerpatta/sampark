"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { setRequestStatus } from "./actions";

/**
 * Close / reopen.
 *
 * This used to open a window.confirm when students were still unanswered. It
 * does not any more. A modal asking "close anyway?" is a question she cannot
 * answer: she is looking at a grey box, not at the screen that would tell her
 * whether it matters, and the only two things she can do are guess and cancel.
 *
 * So it closes, says exactly what that cost, and offers to put it back. Reopen
 * genuinely restores the prior state — the token starts working again and
 * nothing was destroyed — which is what makes an undo honest here.
 *
 * The label flips the moment she taps. The server catches up.
 */
export function StatusControls({
  requestId,
  status,
  answered,
  rosterSize,
}: {
  requestId: string;
  status: string;
  answered: number;
  rosterSize: number;
}) {
  const [pending, startTransition] = useTransition();
  const [shownStatus, setShownStatus] = useOptimistic(status);
  const router = useRouter();
  const toast = useToast();
  const closed = shownStatus === "closed";

  function change(next: "open" | "closed", announce = true) {
    // The optimistic update and the refresh have to sit inside the SAME
    // transition. Split them and React drops the optimistic value the instant
    // the action resolves, which is before the fresh data has arrived — so the
    // button flickers back to its old label and then forward again.
    startTransition(async () => {
      setShownStatus(next);
      await setRequestStatus(requestId, next);
      router.refresh();

      if (!announce) return;

      if (next === "closed") {
        const remaining = rosterSize - answered;
        toast({
          message:
            remaining > 0
              ? `Closed. The link is dead, and ${remaining} of ${rosterSize} students were never answered for.`
              : "Closed. The link is dead.",
          tone: remaining > 0 ? "danger" : "info",
          undoLabel: "Reopen",
          undo: () => change("open", false),
        });
      } else {
        toast({ message: "Reopened. The link works again.", tone: "success" });
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => change(closed ? "open" : "closed")}
        disabled={pending}
        className={`min-h-[var(--tap-min)] rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
          closed
            ? "bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)]"
            : "border border-[var(--color-border)] text-[var(--color-danger)] hover:bg-[var(--color-surface-muted)]"
        }`}
      >
        {closed ? "Reopen the link" : "Close the request"}
      </button>
      <span className="text-xs text-[var(--color-ink-muted)]">
        {closed
          ? "The link is dead — it 404s exactly like an unknown token."
          : "Closing kills the link straight away, before the due date."}
      </span>
    </div>
  );
}
