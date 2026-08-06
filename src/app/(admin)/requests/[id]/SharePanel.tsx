"use client";

import { useState } from "react";

/**
 * The share panel.
 *
 * v1 is copy-paste on purpose (plan section 11): the office copies the message
 * and sends it from their own WhatsApp. Automated sending waits until the
 * manual flow is proven.
 */
export function SharePanel({
  url,
  message,
  whatsappUrl,
  teacherName,
  sentTo,
  overridden,
  reminder,
}: {
  url: string;
  message: string;
  whatsappUrl: string;
  teacherName: string;
  /** The number this link goes to — her saved one, or the override. */
  sentTo: string;
  /** True when the office typed a different number when creating this. */
  overridden: boolean;
  /** True once she has started, so the message becomes a nudge not a first ask. */
  reminder: boolean;
}) {
  const [copied, setCopied] = useState<"link" | "message" | null>(null);

  async function copy(text: string, which: "link" | "message") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused; the text is on screen and selectable,
      // so there is nothing to recover from.
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {reminder ? `Remind ${teacherName}` : `Send it to ${teacherName}`}
      </h2>

      {/* Which number, said out loud. It is the one detail that decides
          whether this link reaches anybody, and it used to be invisible. */}
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Going to <span className="font-mono">{sentTo}</span>
        {overridden
          ? ` — typed for this request. ${teacherName}'s saved number is unchanged.`
          : ""}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-xs">
          {url}
        </code>
        <button
          type="button"
          onClick={() => copy(url, "link")}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
        >
          {copied === "link" ? "Copied" : "Copy link"}
        </button>
      </div>

      <p className="mt-4 text-xs font-medium text-[var(--color-ink-muted)]">
        Hindi message, ready to paste
      </p>
      <pre
        lang="hi"
        className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm"
      >
        {message}
      </pre>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copy(message, "message")}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
        >
          {copied === "message" ? "Copied" : "Copy message"}
        </button>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-lg bg-[var(--color-success)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Open in WhatsApp
        </a>
      </div>

      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        Anyone holding this link can see this class&rsquo;s roster, so send it
        to the teacher directly rather than to a group.
      </p>
    </section>
  );
}
