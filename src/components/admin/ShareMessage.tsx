import { CopyButton } from "@/components/ui/CopyButton";

/**
 * A ready-made WhatsApp message, with a way to read it before sending it.
 *
 * A SERVER COMPONENT, and only the button inside it is not. RoundNudge builds
 * its message in the browser because the same string is also a wa.me href and
 * would otherwise be shipped twice, once as the URL and once as the payload.
 * These messages have no href — the destination is a group, which wa.me cannot
 * address — so there is nothing to duplicate and no reason to ship a builder to
 * the phone.
 *
 * THE PREVIEW IS A NATIVE <details>, not a modal. This codebase has no dialog
 * component anywhere, on purpose, and disclosure is already done this way in
 * the review summary and the filter bar. It also means the office can read what
 * it is about to paste with JavaScript switched off, which the copy button
 * itself cannot promise.
 *
 * `note` is where a screen says WHO a message is for. That is not decoration:
 * one of these lists names children and one names nobody, and the difference
 * decides which WhatsApp group it may go in.
 */
export function ShareMessage({
  title,
  hint,
  message,
  note,
  copyLabel = "Copy",
  tone,
}: {
  title: string;
  hint?: React.ReactNode;
  message: string;
  note?: React.ReactNode;
  copyLabel?: string;
  tone?: "primary" | "go" | "quiet";
}) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-name font-medium">{title}</p>
          {hint ? (
            <p className="mt-0.5 text-label text-[var(--color-ink-muted)]">
              {hint}
            </p>
          ) : null}
        </div>
        <CopyButton
          text={message}
          label={copyLabel}
          tone={tone}
          className="shrink-0"
        />
      </div>

      {note ? (
        <p className="mt-2 text-meta text-[var(--color-ink-muted)]">{note}</p>
      ) : null}

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
