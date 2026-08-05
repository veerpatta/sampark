"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRequestStatus } from "./actions";

/**
 * Close / reopen.
 *
 * Closing kills the link immediately. That is worth a confirmation step — if a
 * teacher is midway through a class of forty, closing it under her costs her
 * the unsent half of her work.
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
  const router = useRouter();
  const closed = status === "closed";

  function change(next: "open" | "closed") {
    if (next === "closed" && answered < rosterSize) {
      const remaining = rosterSize - answered;
      const ok = window.confirm(
        `${remaining} of ${rosterSize} students have not been answered for yet.\n\n` +
          `Closing stops the link working immediately. If the teacher is still filling it in, she will lose anything she has not sent.\n\nClose anyway?`,
      );
      if (!ok) return;
    }

    startTransition(async () => {
      await setRequestStatus(requestId, next);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => change(closed ? "open" : "closed")}
        disabled={pending}
        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
          closed
            ? "bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)]"
            : "border border-[var(--color-border)] text-[var(--color-danger)] hover:bg-[var(--color-surface-muted)]"
        }`}
      >
        {pending
          ? "Working…"
          : closed
            ? "Reopen the link"
            : "Close the request"}
      </button>
      <span className="text-xs text-[var(--color-ink-muted)]">
        {closed
          ? "The link is dead — it 404s exactly like an unknown token."
          : "Closing kills the link straight away, before the due date."}
      </span>
    </div>
  );
}
