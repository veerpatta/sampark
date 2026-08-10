"use client";

import { Bi } from "./Bi";
import { T, type Phrase } from "./strings";
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
 * single line with a count, because thirty-eight rows of "this one is right" is
 * a wall that hides the six that matter.
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
  error: Phrase | null;
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
          <Bi t={pending > 0 ? T.receiptFilled : T.receiptSent} />
        </h2>
        <button
          type="button"
          onClick={onBack}
          className="min-h-12 shrink-0 px-2 text-sm font-medium text-[var(--color-brand-600)] underline"
        >
          <Bi t={T.backToList} />
        </button>
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        <Bi t={T.receiptCounts(total, sent, pending)} />
      </p>

      {/* ================================================= what she changed */}
      {changed.length > 0 ? (
        <div className="mt-5">
          <h3 className="px-1 text-base font-semibold text-[var(--color-correct-fg)]">
            <Bi t={T.youChanged(changed.length)} />
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
                    <Bi t={{ en: entry.labelEn, hi: entry.labelHi }} />
                  </span>
                  <span className="mt-1 flex flex-wrap items-baseline gap-2 font-mono text-sm">
                    <span className="line-through opacity-60">
                      {entry.from ?? T.wasEmpty.en}
                    </span>
                    <span aria-hidden>→</span>
                    <span className="font-semibold">{entry.to}</span>
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-brand-600)] underline">
                    <Bi t={T.tapToFix} />
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
            <Bi t={T.youConfirmed(confirmed.length)} />
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
            <Bi t={T.notInClassCount(notPresent.length)} />
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
            <Bi t={T.partialCount(partial.length)} />
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
                      — {entry.missing.map((field) => field.en).join(", ")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            <Bi t={T.partialNote} />
          </p>
        </div>
      ) : null}

      {/* ======================================= what she has not answered */}
      {untouched.length > 0 ? (
        <div className="mt-4 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-warning)] px-4 py-3">
          <h3 className="text-base font-semibold text-[var(--color-warning)]">
            <Bi t={T.untouchedCount(untouched.length)} />
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
            <Bi t={T.untouchedNote} />
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] border-2 border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm font-medium text-[var(--color-danger)]"
        >
          <Bi t={error} />
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
            className="min-h-12 w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-2 font-semibold text-white disabled:opacity-40"
          >
            <Bi
              t={
                busy
                  ? T.sending
                  : online
                    ? T.sendNow(pending)
                    : T.willGoWhenOnline
              }
            />
          </button>
        ) : (
          <p className="min-h-12 rounded-lg bg-[var(--color-confirm-bg)] px-4 py-3 text-center font-semibold text-[var(--color-confirm-fg)]">
            <Bi t={summary.empty ? T.nothingFilledYet : T.allReached} />
          </p>
        )}
        {!online ? (
          <p className="mt-2 text-center text-xs text-[var(--color-ink-muted)]">
            <Bi t={T.offlineSafe} />
          </p>
        ) : null}
      </div>
    </section>
  );
}
