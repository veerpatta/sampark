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
 * — the clipboard is not a workaround, it is the only mechanism there is.
 *
 * NEITHER BUTTON IS `go`. That tone is reserved for sends that leave the app,
 * and a copy does not leave anything; spending it here would dilute the one
 * signal the office has for "this is about to reach a teacher". They are
 * siblings of equal weight, so they get the same shape and the block titles do
 * the distinguishing.
 *
 * BUILT FOR 360px FIRST. Driven at that width the earlier shape put a wrapped
 * button against the card's right edge, where it read as an accident rather
 * than a control — flex-wrap had dropped it onto its own line and
 * justify-between then had nothing to push against. The button is now full
 * width on a phone and returns beside the text at `sm`, which is the same rule
 * the rest of the console follows.
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
    <section className="mt-4 border-t border-[var(--color-border)] pt-4">
      <h3 className="text-label font-medium">Post it where everyone sees it</h3>
      <p className="mt-0.5 text-meta text-[var(--color-ink-muted)]">
        WhatsApp cannot open a group from a link, so these are copied and
        pasted.
      </p>

      <div className="mt-3 space-y-3">
        <Block
          title="The round, in numbers"
          note="Groups only — no names, no link. Safe for the staff group."
          message={status}
          which="status"
          label="Copy the summary"
          copiedKey={copiedKey}
          onCopy={copy}
        />

        {pending ? (
          <Block
            title="Every child still to come"
            note="Names children. Send it to the class teachers, not to a school-wide group."
            message={pending}
            which="pending"
            label="Copy every name"
            copiedKey={copiedKey}
            onCopy={copy}
          />
        ) : null}
      </div>
    </section>
  );
}

/**
 * One message: what it is, who it may go to, one control, and the text itself.
 *
 * The note is NOT inside the disclosure. One of these two names children and
 * one does not, and that difference decides which WhatsApp group it may be
 * pasted into — so it has to be readable before the copy, not one tap behind
 * it.
 */
function Block({
  title,
  note,
  message,
  which,
  label,
  copiedKey,
  onCopy,
}: {
  title: string;
  note: string;
  message: string;
  which: string;
  label: string;
  copiedKey: string | null;
  onCopy: (text: string, which: string) => void;
}) {
  const copied = copiedKey === which;
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      <p className="text-name font-medium">{title}</p>
      <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">{note}</p>

      <button
        type="button"
        onClick={() => onCopy(message, which)}
        className={`${btn()} mt-2 w-full px-4 sm:w-auto`}
      >
        <span aria-live="polite">{copied ? "Copied" : label}</span>
      </button>

      {/* Its own block, not a flex sibling of the button: opened inside a row
          the preview inherits whatever width is left over, which on a phone is
          none. */}
      <details className="mt-1">
        <summary className="inline-flex min-h-[var(--tap-min)] cursor-pointer items-center text-label text-[var(--color-brand-600)]">
          Read it first
        </summary>
        <pre
          lang="hi"
          className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
        >
          {message}
        </pre>
      </details>
    </div>
  );
}
