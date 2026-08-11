"use client";

import { CaretRight, CheckSquare, CloudCheck } from "@phosphor-icons/react";
import { Bi } from "./Bi";
import { useTyping } from "./focus";
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
  const typing = useTyping();

  /*
   * WHILE SHE IS TYPING THIS IS A THIN LINE AND NOTHING ELSE.
   *
   * The bar and the header were taking about a third of a 667px phone between
   * them, and the third that hurts is this one: it sits directly above the
   * keyboard, so the space it costs comes out of the two or three cards left
   * visible between the two. Nothing on it can be used mid-word — the review
   * button opens another screen, the counts are the same counts she can read on
   * the cards — so while the keyboard is up it collapses to the progress line,
   * which is the one thing worth a few pixels: how much is left.
   *
   * It comes straight back when she stops. See useTyping in focus.ts for why
   * focus rather than a viewport measurement answers "is the keyboard up".
   */
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[var(--shadow-rail)] backdrop-blur-sm">
      {typing ? (
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={T.remainingShort(remaining).en}
          className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]"
        >
          <div
            className="h-full rounded-full bg-[var(--color-brand-600)] transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : (
      <>
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
        className="mt-3 flex min-h-14 w-full items-center justify-between rounded-[var(--radius-card)] bg-[var(--color-brand-600)] px-5 py-2.5 font-semibold text-white shadow-[var(--shadow-cta)] transition-transform active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
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
      </>
      )}
    </div>
  );
}
