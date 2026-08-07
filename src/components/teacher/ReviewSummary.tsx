"use client";

import type { Summary } from "./summary";

/**
 * "This is what you have sent."
 *
 * A receipt, not a gate. Answers now upload by themselves as she works, so this
 * screen no longer stands between her and the school — it is where she checks
 * what went, and fixes anything that should not have. Every change is tappable
 * for exactly that reason, and a correction supersedes what went before.
 *
 * Weighting is unchanged and still deliberate. The changes are listed in full
 * because those are the rows worth checking. The confirmations collapse to a
 * single line with a count, because thirty-eight rows of "यह सही है" is a wall
 * that hides the six that matter.
 *
 * Unanswered rows are named plainly but block nothing. She may genuinely not
 * know — the child left, the family moved, nobody has the number — and holding
 * back a class's worth of correct answers behind four she cannot give would
 * help no one.
 */
export function ReviewSummary({
  summary,
  total,
  pending,
  sent,
  busy,
  online,
  error,
  onFix,
  onBack,
  onSend,
}: {
  summary: Summary;
  total: number;
  /** Answered but not yet acknowledged by the server. */
  pending: number;
  /** Acknowledged. */
  sent: number;
  busy: boolean;
  online: boolean;
  error: string | null;
  /** Jump back to the list with that row open. */
  onFix: (studentId: string) => void;
  onBack: () => void;
  onSend: () => void;
}) {
  const { changed, confirmed, notPresent, partial, untouched } = summary;

  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {pending > 0 ? "आपने यह भरा है" : "आपने यह भेजा है"}
        </h2>
        <button
          type="button"
          onClick={onBack}
          className="min-h-12 shrink-0 px-2 text-sm font-medium text-[var(--color-brand-600)] underline"
        >
          वापस सूची में
        </button>
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        कुल {total} बच्चों में से · {sent} विद्यालय पहुँच गए
        {pending > 0 ? ` · ${pending} जा रहे हैं` : ""}
      </p>

      {/* ================================================= what she changed */}
      {changed.length > 0 ? (
        <div className="mt-5">
          <h3 className="px-1 text-base font-semibold text-[var(--color-correct-fg)]">
            आपने {changed.length} बदले
          </h3>
          <ul className="mt-2 space-y-2">
            {changed.map((entry) => (
              <li key={`${entry.studentId}-${entry.fieldKey}`}>
                <button
                  type="button"
                  onClick={() => onFix(entry.studentId)}
                  className="block w-full rounded-[var(--radius-card)] border-2 border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-4 py-3 text-left"
                >
                  <span className="block font-medium">{entry.name}</span>
                  <span className="mt-0.5 block text-sm text-[var(--color-ink-muted)]">
                    {entry.labelHi}
                  </span>
                  <span className="mt-1 flex flex-wrap items-baseline gap-2 font-mono text-sm">
                    <span className="line-through opacity-60">
                      {entry.from ?? "कुछ नहीं था"}
                    </span>
                    <span aria-hidden>→</span>
                    <span className="font-semibold">{entry.to}</span>
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-brand-600)] underline">
                    ठीक करने के लिए दबाएँ
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* =============================== what she confirmed, collapsed to one */}
      {confirmed.length > 0 ? (
        <details className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 py-3">
          <summary className="cursor-pointer text-base font-semibold text-[var(--color-confirm-fg)]">
            आपने {confirmed.length} की जानकारी सही बताई
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-[var(--color-confirm-fg)]">
            {confirmed.map((entry) => (
              <li key={entry.studentId}>{entry.name}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* ================================================= not in this class */}
      {notPresent.length > 0 ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-absent-border)] bg-[var(--color-absent-bg)] px-4 py-3">
          <h3 className="text-base font-semibold text-[var(--color-absent-fg)]">
            {notPresent.length} बच्चे इस कक्षा में नहीं हैं
          </h3>
          <ul className="mt-1 space-y-1 text-sm text-[var(--color-absent-fg)]">
            {notPresent.map((entry) => (
              <li key={entry.studentId}>{entry.name}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ==================================== sent, and still missing a box */}
      {/* Above the unanswered block on purpose. These are the cards she has
          already worked on, so they are the ones she is closest to finishing —
          and unlike an unanswered row, part of this one has already gone. */}
      {partial.length > 0 ? (
        <div className="mt-4 rounded-[var(--radius-card)] border-2 border-[var(--color-partial-border)] bg-[var(--color-partial-bg)] px-4 py-3">
          <h3 className="text-base font-semibold text-[var(--color-partial-fg)]">
            {partial.length} बच्चों की एक जानकारी बाकी है
          </h3>
          <ul className="mt-2 space-y-1">
            {partial.map((entry) => (
              <li key={entry.studentId}>
                <button
                  type="button"
                  onClick={() => onFix(entry.studentId)}
                  className="min-h-12 text-left text-sm font-medium text-[var(--color-brand-600)] underline"
                >
                  {entry.name}
                  {entry.missing.length > 0 ? (
                    <span className="ml-1 font-normal text-[var(--color-partial-fg)] no-underline">
                      — {entry.missing.join(", ")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            आपने जो भरा वह विद्यालय पहुँच चुका है। बाकी नाम दबाकर पूरा कर दें।
          </p>
        </div>
      ) : null}

      {/* ======================================= what she has not answered */}
      {untouched.length > 0 ? (
        <div className="mt-4 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-warning)] px-4 py-3">
          <h3 className="text-base font-semibold text-[var(--color-warning)]">
            {untouched.length} बच्चों का जवाब बाकी है
          </h3>
          <ul className="mt-2 space-y-1">
            {untouched.map((entry) => (
              <li key={entry.studentId}>
                <button
                  type="button"
                  onClick={() => onFix(entry.studentId)}
                  className="min-h-12 text-left text-sm font-medium text-[var(--color-brand-600)] underline"
                >
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            बाकी को अभी भी भेज सकती हैं। जो बचे हैं, बाद में भर दें।
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] border-2 border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm font-medium text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {/* Not a gate any more — an escape hatch. Everything here goes by itself
          within a few seconds; this is for the moment she is standing by the
          gate about to leave and wants it gone NOW. When nothing is waiting it
          says so rather than offering a button that would do nothing. */}
      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pb-[env(safe-area-inset-bottom)] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
        {pending > 0 ? (
          <button
            type="button"
            onClick={onSend}
            disabled={busy}
            className="min-h-12 w-full rounded-lg bg-[var(--color-brand-600)] px-4 font-semibold text-white disabled:opacity-40"
          >
            {busy
              ? "भेजा जा रहा है…"
              : online
                ? `अभी भेजें (${pending})`
                : "इंटरनेट आते ही चला जाएगा"}
          </button>
        ) : (
          <p className="min-h-12 rounded-lg bg-[var(--color-confirm-bg)] px-4 py-3 text-center font-semibold text-[var(--color-confirm-fg)]">
            {summary.empty
              ? "अभी कुछ भरा नहीं है"
              : "सब विद्यालय पहुँच गया ✓"}
          </p>
        )}
        {!online ? (
          <p className="mt-2 text-center text-xs text-[var(--color-ink-muted)]">
            इंटरनेट नहीं है — सब फ़ोन में सुरक्षित है और जुड़ते ही चला जाएगा।
          </p>
        ) : null}
      </div>
    </section>
  );
}
