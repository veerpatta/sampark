"use client";

import { Bi } from "./Bi";
import { T } from "./strings";

/**
 * The sticky bar at the bottom of the teacher surface.
 *
 * It answers the only two questions she has while working: how much is LEFT,
 * and how do I send it. It counts down rather than up — "6 left" tells her when
 * she can stop, which is what she actually wants to know; "40 / 46 done" makes
 * her do the subtraction herself.
 *
 * It sits at the BOTTOM because that is where a thumb already is on a phone
 * held one-handed.
 *
 * "saved on the phone" and "sent to school" stay separate lines. On a bad
 * signal those are genuinely different facts and collapsing them into one tick
 * would be a lie.
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
  /** Students not finished yet — including ones with a box still empty. */
  remaining: number;
  total: number;
  /**
   * Rows with anything worth looking at on the receipt.
   *
   * Separate from `total - remaining` on purpose: a row that is half filled has
   * been sent and is not done, so it must not move the bar, but locking her out
   * of the receipt because none of her work is finished would be its own kind
   * of lie.
   */
  reviewable: number;
  /** Answers made since the last successful send. */
  pending: number;
  /** Answers the school already has. */
  sent: number;
  busy: boolean;
  online: boolean;
  /** Opens the summary. This bar no longer sends — see ReviewSummary. */
  onReview: () => void;
}) {
  const done = total - remaining;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="sticky bottom-0 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pb-[env(safe-area-inset-bottom)] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between text-sm">
        {remaining === 0 ? (
          <span className="font-medium text-[var(--color-confirm-fg)]">
            <Bi t={T.allDone} />
          </span>
        ) : (
          <span className="font-medium">
            <Bi t={T.remaining(remaining)} />
          </span>
        )}
        {/* "Reached the school" is the one that matters, so it gets the tick
            and a spring on every increase. Saved-on-phone below stays flat
            grey text — the two must never look alike, because on a bad signal
            they are genuinely different facts. */}
        {sent > 0 ? (
          // key={sent} remounts the span on every increase, which restarts the
          // pop. The tick and the colour are what separate this from the grey
          // saved-on-phone line below.
          <span
            key={sent}
            className="animate-[pop_240ms_ease-out] flex items-start gap-1 font-medium text-[var(--color-confirm-fg)]"
          >
            <span aria-hidden>✓</span>
            <span>
              <Bi t={T.sentCount(sent)} />
            </span>
          </span>
        ) : null}
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
      >
        {/* Slides to its new width rather than jumping. "How much is left" is
            a question she is asking constantly, and a bar that travels answers
            it in a way a bar that teleports does not. */}
        <div
          className="h-full rounded-full bg-[var(--color-success)] transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {pending > 0 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          <Bi t={busy ? T.sending : T.savedGoing(pending)} />
        </p>
      ) : null}

      {/* Opens the receipt. It does not send and no longer needs to — answers
          go by themselves — so this is for looking, and the label says only
          that. It is enabled as soon as there is anything to look at. */}
      <button
        type="button"
        onClick={onReview}
        disabled={reviewable === 0}
        className="mt-2 min-h-12 w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-2 font-semibold text-white disabled:opacity-40"
      >
        <Bi t={reviewable === 0 ? T.answerFirst : T.review(reviewable)} />
      </button>
      {pending > 0 && !online ? (
        <p className="mt-1 text-center text-xs text-[var(--color-ink-muted)]">
          <Bi t={T.offlineKeepGoing} />
        </p>
      ) : null}
    </div>
  );
}
