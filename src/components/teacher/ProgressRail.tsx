"use client";



/**
 * The sticky bar at the bottom of the teacher surface.
 *
 * It answers the only two questions she has while working: how much is LEFT,
 * and how do I send it. It counts down rather than up — "अभी 6 बाकी हैं" tells
 * her when she can stop, which is what she actually wants to know;
 * "40 / 46 हो गए" makes her do the subtraction herself.
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
  pending,
  sent,
  busy,
  online,
  onReview,
}: {
  /** Students with no answer yet. */
  remaining: number;
  total: number;
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
            सब पूरे हैं
          </span>
        ) : (
          <span className="font-medium">
            अभी {remaining} बाकी हैं
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
            className="animate-[pop_240ms_ease-out] flex items-center gap-1 font-medium text-[var(--color-confirm-fg)]"
          >
            <span aria-hidden>✓</span>
            {sent} विद्यालय पहुँच गए
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
          {busy
            ? "भेजा जा रहा है…"
            : `${pending} फ़ोन में सुरक्षित, अपने आप जा रहे हैं`}
        </p>
      ) : null}

      {/* Opens the receipt. It does not send and no longer needs to — answers
          go by themselves — so this is for looking, and the label says only
          that. It is enabled as soon as there is anything to look at. */}
      <button
        type="button"
        onClick={onReview}
        disabled={done === 0}
        className="mt-2 min-h-12 w-full rounded-lg bg-[var(--color-brand-600)] px-4 font-semibold text-white disabled:opacity-40"
      >
        {done === 0 ? "पहले जवाब दें" : `देखें (${done})`}
      </button>
      {pending > 0 && !online ? (
        <p className="mt-1 text-center text-xs text-[var(--color-ink-muted)]">
          इंटरनेट नहीं है — काम करती रहें, जुड़ते ही अपने आप चला जाएगा।
        </p>
      ) : null}
    </div>
  );
}
