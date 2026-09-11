"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui/controls";
import { useCopy } from "@/components/ui/useCopy";
import { useToast } from "@/components/ui/Toast";
import { issueOfficeLink, revokeOfficeLink, sendOfficeLink } from "./actions";

/**
 * The office's standing page: one link, saved once, listing every open round.
 *
 * WHY IT EXISTS BESIDE THE PER-ROUND LINK. A master link is sent when a round
 * is created, which is the right moment for it — but the habit it has to fit is
 * somebody opening a bookmark on a Tuesday to see what is still outstanding,
 * and a bookmark cannot be "whichever message arrived last week". This is the
 * durable teacher page (/t/), pointed at the office's own row.
 *
 * ROTATE IS THE SAME BUTTON AS ISSUE. There is no separate rotation: a new
 * token overwrites the old in one statement, so the previous URL dies as the
 * new one is born. The screen says so rather than implying two operations.
 */
export function OfficeLink({
  token,
  issuedAt,
  origin,
  hasOffice,
  apiEnabled,
}: {
  token: string | null;
  issuedAt: string | null;
  origin: string;
  hasOffice: boolean;
  apiEnabled: boolean;
}) {
  const [current, setCurrent] = useState(token);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { copy, copiedKey } = useCopy();
  const show = useToast();

  const url = current ? `${origin}/t/${current}` : null;

  /** Issue and rotate are one UPDATE, so they are one function and one button. */
  async function issue() {
    const result = await issueOfficeLink();
    setError(result.error);
    if (!result.token) return;
    setCurrent(result.token);
    show({
      message: current
        ? "New address. The old one is dead."
        : "Standing page created.",
    });
  }

  return (
    <div className="mt-2">
      <p className="text-sm text-[var(--color-ink-muted)]">
        One page listing every round that is still open, with the master link
        for each. Save it once; the next round simply appears on it.
      </p>

      {url ? (
        <>
          <p className="mt-3 break-all rounded-[var(--radius-control)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-meta">
            {url}
          </p>
          {issuedAt ? (
            <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
              issued {issuedAt}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          No standing page yet.
        </p>
      )}

      {error ? (
        <p className="mt-2 text-sm text-[var(--color-danger-fg)]">{error}</p>
      ) : null}

      {/*
       * ONE COLUMN ON A PHONE. Four buttons in a wrapping row is a two-by-two
       * grid whose shape changes with the width of its own labels, so nothing
       * is ever twice in the same place — and two of these four are
       * destructive. They stack full width below `sm` and return to a row above
       * it, the same rule the master link card follows.
       *
       * The two that end an address — rotate and revoke — are folded into a
       * disclosure below, away from the two that hand it out.
       */}
      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
        {url ? (
          <button
            type="button"
            onClick={() => copy("office", url)}
            className={btn({ tone: "quiet", full: true }) + " sm:w-auto"}
          >
            {copiedKey === "office" ? "Copied" : "Copy link"}
          </button>
        ) : null}

        {!current ? (
          <button
            type="button"
            disabled={pending || !hasOffice}
            onClick={() => start(() => issue())}
            className={btn({ tone: "primary", full: true }) + " sm:w-auto"}
          >
            {pending ? "Working…" : "Create it"}
          </button>
        ) : null}

        {url && apiEnabled ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const outcome = await sendOfficeLink();
                setError(outcome.ok ? null : outcome.error);
                if (outcome.ok) show({ message: "Sent to the office." });
              })
            }
            className={btn({ shape: "commit", tone: "go", full: true }) + " sm:w-auto"}
          >
            Send it on WhatsApp
          </button>
        ) : null}
      </div>

      {url ? (
        <details className="mt-3 border-t border-[var(--color-border)] pt-3">
          <summary className="flex min-h-[var(--tap-min)] cursor-pointer list-none items-center text-sm text-[var(--color-ink-muted)]">
            This link went somewhere it should not have
          </summary>
          <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
            Rotating gives it a new address and kills the old one in the same
            moment. Revoking ends it with no replacement — the office has no
            standing page until somebody makes one again.
          </p>
          <div className="mt-2 grid gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              disabled={pending}
              onClick={() => start(() => issue())}
              className={btn({ tone: "danger", full: true }) + " sm:w-auto"}
            >
              Rotate the address
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await revokeOfficeLink();
                  setError(result.error);
                  if (!result.error) {
                    setCurrent(null);
                    show({ message: "Revoked. That address is dead." });
                  }
                })
              }
              className={btn({ tone: "quiet", full: true }) + " sm:w-auto"}
            >
              Revoke it
            </button>
          </div>
        </details>
      ) : null}

      <p className="mt-3 text-meta text-[var(--color-ink-muted)]">
        Unlike a teacher&rsquo;s page, this one may carry a photo or Aadhaar
        round — those are the rounds the office is most likely to be finishing.
        &ldquo;Revoke every link&rdquo; in Settings → Teachers kills this one
        too, which is what a kill switch is for.
      </p>
    </div>
  );
}
