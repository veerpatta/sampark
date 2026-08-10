"use client";

import { CaretRight, CheckSquare, CloudCheck } from "@phosphor-icons/react";
import { Bi } from "./Bi";
import { T } from "./strings";

/**
 * The compact, thumb-first summary at the bottom of the teacher form.
 * Remaining work, upload truth, progress, and review stay visible without
 * turning the rail into a second dashboard.
 */
export function ProgressRail({
  remaining,
  total,
  reviewable,
  pending,
  sent,
  busy,
  online,
  onReview,
}: {
  remaining: number;
  total: number;
  reviewable: number;
  pending: number;
  sent: number;
  busy: boolean;
  online: boolean;
  onReview: () => void;
}) {
  const done = total - remaining;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-6px_20px_rgba(15,23,42,0.09)] backdrop-blur-sm">
      <div className="grid grid-cols-[0.72fr_1fr_1.25fr] items-start gap-3 text-sm">
        <div>
          <p
            className={`font-semibold ${
              remaining === 0
                ? "text-[var(--color-confirm-fg)]"
                : "text-[var(--color-ink)]"
            }`}
          >
            <Bi t={remaining === 0 ? T.allDone : T.remainingShort(remaining)} />
          </p>
        </div>

        <div>
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-border)]"
          >
            <div
              className="h-full rounded-full bg-[var(--color-brand-600)] transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            <Bi t={T.sentShort(sent)} />
          </p>
        </div>

        <div
          key={`${sent}-${pending}`}
          className={`flex items-start gap-2 ${
            sent > 0 && pending === 0
              ? "animate-[pop_240ms_ease-out] text-[var(--color-confirm-fg)]"
              : "text-[var(--color-ink-muted)]"
          }`}
        >
          <CloudCheck
            aria-hidden
            size={24}
            weight="duotone"
            className="shrink-0"
          />
          <p className="text-xs font-medium leading-snug">
            <Bi
              t={
                pending > 0
                  ? busy
                    ? T.sending
                    : T.onPhoneWillSend
                  : sent > 0
                    ? T.sentShort(sent)
                    : T.savedAutomatically
              }
            />
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onReview}
        disabled={reviewable === 0}
        className="mt-3 flex min-h-14 w-full items-center justify-between rounded-xl bg-[var(--color-brand-600)] px-5 py-2.5 font-semibold text-white shadow-[0_6px_16px_rgba(37,99,235,0.22)] transition-transform active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
      >
        <CheckSquare aria-hidden size={28} weight="duotone" />
        <Bi t={T.reviewAnswers} />
        <CaretRight aria-hidden size={24} weight="bold" />
      </button>

      {pending > 0 && !online ? (
        <p className="mt-2 text-center text-xs text-[var(--color-ink-muted)]">
          <Bi t={T.offlineKeepGoing} />
        </p>
      ) : null}
    </div>
  );
}
