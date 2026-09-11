"use client";

import { useState, useTransition } from "react";
import { btn, field } from "@/components/ui/controls";
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
        <h2 className="text-label font-medium">No master link for this round</h2>
        <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
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
          className={`${btn({ tone: "primary" })} mt-3 w-full md:w-auto`}
        >
          {pending ? "Making…" : "Make one"}
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-brand-200)] bg-[var(--color-surface)] p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-label font-medium">Master link · all classes</h2>
        <span className="font-mono text-meta text-[var(--color-ink-muted)]">
          {master?.rosterSize ?? 0} children
        </span>
      </div>
      <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
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

      <p className="mt-3 break-all rounded-[var(--radius-control)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-meta">
        {url}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copy("master", url!)}
          className={btn({ tone: "quiet" })}
        >
          {copiedKey === "master" ? "Copied" : "Copy link"}
        </button>
        <a
          href={buildWhatsAppLink(typed || officePhone || "", message)}
          target="_blank"
          rel="noreferrer"
          className={btn({ tone: "quiet" })}
        >
          Open in WhatsApp instead
        </a>
      </div>

      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <label className="block">
          <span className="text-label font-medium">Send it to a number</span>
          <span className="mt-0.5 block text-meta text-[var(--color-ink-muted)]">
            The office&rsquo;s own number is filled in. Change it to send this to
            whoever is doing the round.
          </span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            placeholder="9XXXXXXXXX"
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
          className={`${btn({ shape: "commit", tone: "go" })} mt-3 w-full md:w-auto`}
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
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
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
            className={btn({ tone: "danger" })}
          >
            Rotate the address
          </button>
          <p className="mt-1 text-meta text-[var(--color-ink-muted)]">
            For a link that reached somebody it should not have. The old address
            stops working immediately, and anyone still using it loses an
            unsaved page.
          </p>
        </div>
      ) : null}
    </section>
  );
}
