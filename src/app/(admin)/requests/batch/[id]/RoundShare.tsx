"use client";

import { useCopy } from "@/components/ui/useCopy";
import { btn } from "@/components/ui/controls";

/**
 * The round, as something that can leave the building.
 *
 * COPY, NOT A SEND BUTTON, AND THAT IS THE WHOLE POINT. Every other handover in
 * this app is a wa.me link, because wa.me carries the number and opens on that
 * one conversation. But wa.me addresses a PERSON: WhatsApp exposes no
 * click-to-chat URL for a group at all. The moment the destination is the staff
 * group or a class group — which is exactly what the build plan means by "share
 * '8 of 11 classes submitted' in the staff group. Nobody wants to be in the 3."
 * — the clipboard is not a workaround, it is the only mechanism there is. Until
 * now that sentence existed on the dashboard as a wa.me link with no number,
 * which opens the contact picker and cannot reach a group either.
 *
 * The messages are built on the SERVER and arrive as strings. Unlike a reminder,
 * whose text is also its href and would otherwise ship twice, these have no URL
 * — so there is nothing here but the two buttons and the preview.
 *
 * A native <details> for the preview, because this codebase has no modal
 * anywhere on purpose, and because the office should be able to read what it is
 * about to paste.
 */
export function RoundShare({
  status,
  pending,
}: {
  /** Groups and counts. Names nobody. Safe for a school-wide group. */
  status: string;
  /** The same round with the children named, or null when none are left. */
  pending: string | null;
}) {
  const { copy, copiedKey } = useCopy();

  return (
    <div className="mt-4 space-y-2">
      <h3 className="text-label font-medium">Post it where everyone sees it</h3>

      <Block
        title="The round, in numbers"
        hint="Which groups are still short, and how far each has got."
        note="Names groups, never teachers, and carries no link — safe for the staff group."
        message={status}
        which="status"
        label="Copy the summary"
        copiedKey={copiedKey}
        onCopy={copy}
        tone="go"
      />

      {pending ? (
        <Block
          title="Every child still to come"
          hint="The same round, with the children named in register order."
          note="This names children. Send it to the class teachers, not to a school-wide group. Names and roll numbers only — no link, no phone number."
          message={pending}
          which="pending"
          label="Copy every name"
          copiedKey={copiedKey}
          onCopy={copy}
        />
      ) : null}
    </div>
  );
}

function Block({
  title,
  hint,
  note,
  message,
  which,
  label,
  copiedKey,
  onCopy,
  tone,
}: {
  title: string;
  hint: string;
  note: string;
  message: string;
  which: string;
  label: string;
  copiedKey: string | null;
  onCopy: (text: string, which: string) => void;
  tone?: "go";
}) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-name font-medium">{title}</p>
          <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
            {hint}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onCopy(message, which)}
          className={`${btn({ tone })} shrink-0 px-3`}
        >
          <span aria-live="polite">
            {copiedKey === which ? "Copied" : label}
          </span>
        </button>
      </div>

      {/* Who it may go to, said out loud. One of these two names children and
          one does not, and that difference decides the destination. */}
      <p className="mt-2 text-meta text-[var(--color-ink-muted)]">{note}</p>

      <details className="mt-2">
        <summary className="inline-flex min-h-[var(--tap-min)] cursor-pointer items-center text-label text-[var(--color-brand-600)]">
          Read it first
        </summary>
        <pre
          lang="hi"
          className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
        >
          {message}
        </pre>
      </details>
    </div>
  );
}
