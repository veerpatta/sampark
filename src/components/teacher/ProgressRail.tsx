"use client";

import { toHindiDigits } from "./digits";

/**
 * The sticky bar at the bottom of the teacher surface.
 *
 * It answers the only two questions she has while working: how much is left,
 * and how do I send it. It sits at the BOTTOM because that is where a thumb
 * already is on a phone held one-handed.
 */
export function ProgressRail({
  done,
  total,
  pending,
  busy,
  online,
  onSubmit,
}: {
  done: number;
  total: number;
  /** Answers made since the last successful send. */
  pending: number;
  busy: boolean;
  online: boolean;
  onSubmit: () => void;
}) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="sticky bottom-0 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pb-[env(safe-area-inset-bottom)] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {toHindiDigits(done)} / {toHindiDigits(total)} हो गए
        </span>
        {done === total && total > 0 ? (
          <span className="text-[var(--color-confirm-fg)]">सब पूरे हैं</span>
        ) : (
          <span className="text-[var(--color-ink-muted)]">
            {toHindiDigits(total - done)} बाकी
          </span>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-success)] transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>

      {pending > 0 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          {toHindiDigits(pending)} फ़ोन में सुरक्षित, अभी भेजे नहीं गए
        </p>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || pending === 0}
        className="mt-2 w-full rounded-lg bg-[var(--color-brand-600)] px-4 font-semibold text-white disabled:opacity-40"
      >
        {busy
          ? "भेजा जा रहा है…"
          : pending === 0
            ? "सब भेज दिया गया"
            : online
              ? `विद्यालय को भेजें (${toHindiDigits(pending)})`
              : `इंटरनेट आते ही भेजें (${toHindiDigits(pending)})`}
      </button>
    </div>
  );
}
