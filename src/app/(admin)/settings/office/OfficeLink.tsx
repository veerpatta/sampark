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

      <div className="mt-3 flex flex-wrap gap-2">
        {url ? (
          <button
            type="button"
            onClick={() => copy("office", url)}
            className={btn({ tone: "quiet" })}
          >
            {copiedKey === "office" ? "Copied" : "Copy link"}
          </button>
        ) : null}

        <button
          type="button"
          disabled={pending || !hasOffice}
          onClick={() =>
            start(async () => {
              const result = await issueOfficeLink();
              setError(result.error);
              if (result.token) {
                setCurrent(result.token);
                show({
                  message: current
                    ? "New address. The old one is dead."
                    : "Standing page created.",
                });
              }
            })
          }
          className={btn({ tone: current ? "danger" : "primary" })}
        >
          {pending ? "Working…" : current ? "Rotate the address" : "Create it"}
        </button>

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
            className={btn({ tone: "go" })}
          >
            Send it on WhatsApp
          </button>
        ) : null}

        {url ? (
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
            className={btn({ tone: "quiet" })}
          >
            Revoke
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-meta text-[var(--color-ink-muted)]">
        Unlike a teacher&rsquo;s page, this one may carry a photo or Aadhaar
        round — those are the rounds the office is most likely to be finishing.
        &ldquo;Revoke every link&rdquo; in Settings → Teachers kills this one
        too, which is what a kill switch is for.
      </p>
    </div>
  );
}
