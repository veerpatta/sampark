"use client";

import { useState, useTransition } from "react";
import { btn, eyebrow, field, mono } from "@/components/ui/controls";
import { useCopy } from "@/components/ui/useCopy";
import { useToast } from "@/components/ui/Toast";
import { buildRequestMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { isCompletePhone, normalisePhone } from "@/lib/phone";
import {
  mintMasterLink,
  rotateMasterLink,
  sendMasterLinkViaApi,
} from "./actions";

/**
 * The round's own link: one address over every class in it.
 *
 * WHY IT IS ABOVE THE SEND QUEUE AND NOT IN IT. The queue is one card per
 * person to chase. This is the opposite move — the link that exists so nobody
 * has to be chased — and putting it among the teachers would make it read as a
 * twentieth teacher, which is exactly the confusion lib/office.ts is built to
 * avoid everywhere else.
 *
 * THE NUMBER IS PRE-FILLED AND STILL EDITABLE. The office's own number already
 * received this on creation; the box is for the person actually doing the
 * round tonight, who is often not the person who made it. Sending it twice is
 * not guarded against, because forwarding it is the feature.
 *
 * "Open in WhatsApp instead" IS NEVER REMOVED, the same rule every other send
 * on this page follows: it is the path for a number the API refuses, a day a
 * template is paused, and a deployment with no key.
 *
 * ONE COLUMN ON A PHONE, AND EVERY CONTROL FULL WIDTH. The console is worked
 * one-handed in a corridor: four buttons wrapped into a ragged two-by-two grid
 * is four targets whose position changes with the width of their own labels.
 * They stack to full width below `sm` and return to a row above it, which is
 * the same rule RoundShare follows one card down.
 */
export function MasterLinkCard({
  batchId,
  master,
  officeName,
  officePhone,
  title,
  dueDate,
  origin,
  apiEnabled,
  canRotate,
}: {
  batchId: string;
  /** Null for a round minted before the office had a number, or a subject round. */
  master: { token: string; rosterSize: number; sentAt: string | null } | null;
  officeName: string;
  officePhone: string | null;
  title: string;
  dueDate: string;
  origin: string;
  apiEnabled: boolean;
  canRotate: boolean;
}) {
  const [token, setToken] = useState(master?.token ?? null);
  const [phone, setPhone] = useState(officePhone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { copy, copiedKey } = useCopy();
  const show = useToast();

  const url = token ? `${origin}/r/${token}` : null;
  const typed = normalisePhone(phone);
  const sendable = isCompletePhone(typed);

  const message = url
    ? buildRequestMessage({
        teacherName: officeName,
        audience: {
          kind: "master",
          label: "All classes",
          rosterSize: master?.rosterSize,
        },
        title,
        dueDate,
        url,
      })
    : "";

  if (!token) {
    return (
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-card">
        <h2 className={eyebrow()}>Master link</h2>
        <p className="mt-1 text-sm font-medium">None for this round</p>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          A master link opens every class in the round at once, so the office can
          finish what the teachers have not. Rounds sent to subject teachers
          never get one — every other kind does, once an office number is set.
        </p>
        {error ? (
          <p className="mt-2 text-sm text-[var(--color-danger-fg)]">{error}</p>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await mintMasterLink(batchId);
              setError(result.error);
              if (result.token) {
                setToken(result.token);
                show({ message: "Master link made." });
              }
            })
          }
          className={`${btn({ tone: "primary", full: true })} mt-3 sm:w-auto`}
        >
          {pending ? "Making…" : "Make one"}
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-brand-200)] bg-[var(--color-surface)] p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className={eyebrow()}>Master link · all classes</h2>
        <span className={mono()}>{master?.rosterSize ?? 0} children</span>
      </div>

      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        One address over every class in this round. It opens with no login and
        dies when the round is closed.
      </p>
      {/* Whether the automatic send on creation actually landed. Silence here
          would be the one thing worth knowing and the one thing not said. */}
      <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
        {master?.sentAt
          ? `Sent to ${officePhone ?? "the office"} on ${master.sentAt}.`
          : "Not sent yet — it was made, but no message has gone out."}
      </p>

      {/* break-all, because a 16-character token after a long origin has no
          space in it to wrap at and would otherwise push the card sideways. */}
      <p className="mt-3 break-all rounded-[var(--radius-control)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-meta">
        {url}
      </p>

      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={() => copy("master", url!)}
          className={btn({ tone: "quiet", full: true }) + " sm:w-auto"}
        >
          {copiedKey === "master" ? "Copied" : "Copy link"}
        </button>
        <a
          href={buildWhatsAppLink(typed || officePhone || "", message)}
          target="_blank"
          rel="noreferrer"
          className={btn({ tone: "quiet", full: true }) + " sm:w-auto"}
        >
          Open in WhatsApp instead
        </a>
      </div>

      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <label className="block">
          <span className="text-sm font-medium">Send it to a number</span>
          <span className="mt-0.5 block text-meta text-[var(--color-ink-muted)]">
            The office&rsquo;s own number is filled in. Change it to send this to
            whoever is doing the round.
          </span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            placeholder="9XXXXXXXXX"
            aria-label="Number to send the master link to"
            className={`${field({ invalid: phone !== "" && !sendable })} mt-2 font-mono`}
          />
        </label>

        {error ? (
          <p className="mt-2 text-sm text-[var(--color-danger-fg)]">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={pending || !sendable || !apiEnabled}
          onClick={() =>
            start(async () => {
              const outcome = await sendMasterLinkViaApi(batchId, typed);
              setError(outcome.ok ? null : outcome.error);
              if (outcome.ok) show({ message: `Sent to ${typed}.` });
            })
          }
          className={`${btn({ shape: "commit", tone: "go", full: true })} mt-3 sm:w-auto`}
        >
          {pending ? "Sending…" : "Send on WhatsApp"}
        </button>

        {apiEnabled ? null : (
          <p className="mt-2 text-meta text-[var(--color-ink-muted)]">
            API sending is off on this deployment — use &ldquo;Open in WhatsApp
            instead&rdquo;.
          </p>
        )}
      </div>

      {canRotate ? (
        <details className="mt-4 border-t border-[var(--color-border)] pt-3">
          {/* Folded away. It is the rarest control on the card and the only
              destructive one, and an always-visible red button beside three
              ordinary ones is a thing somebody eventually taps by accident. */}
          <summary className="flex min-h-[var(--tap-min)] cursor-pointer list-none items-center text-sm text-[var(--color-ink-muted)]">
            The link went somewhere it should not have
          </summary>
          <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
            Rotating replaces the address. The old one stops working
            immediately, and anyone still on it loses an unsaved page.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await rotateMasterLink(batchId);
                setError(result.error);
                if (result.token) {
                  setToken(result.token);
                  show({ message: "New address. The old one is dead." });
                }
              })
            }
            className={`${btn({ tone: "danger", full: true })} mt-2 sm:w-auto`}
          >
            Rotate the address
          </button>
        </details>
      ) : null}
    </section>
  );
}
