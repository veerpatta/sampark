"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ThumbBar } from "./ThumbBar";

/**
 * Tick some rows, do one thing to all of them.
 *
 * WHY THE SELECTION IS A FORM AND NOT REACT STATE. DataTable is a server
 * component — its `columns` carry render functions, which cannot cross to the
 * client — so the rows have to be rendered on the server. Plain checkboxes with
 * a shared name make the selection ordinary DOM state that this component reads
 * on demand, and the table needs to know nothing about any of it.
 *
 * The action is a SERVER ACTION passed down as a prop, called with an array of
 * ids rather than the FormData, so the same function is callable from a test or
 * from another screen without a form in front of it.
 *
 * IT REPORTS WHAT ACTUALLY HAPPENED. Archiving five requests where two of them
 * collected nothing really does delete two and archive three, and a toast
 * claiming "5 archived" would be a lie about the two that are gone for good.
 * Anything the rule refused is named, with its reason.
 */

export type BulkResult = {
  deleted?: number;
  archived?: number;
  closed?: number;
  restored?: number;
  skipped?: { id: string; reason: string }[];
};

export type BulkAction = {
  label: string;
  /** Shown in a browser confirm when the step cannot be walked back. */
  confirm?: (count: number) => string;
  run: (ids: string[]) => Promise<BulkResult>;
  tone?: "default" | "danger";
};

export function BulkBar({
  name,
  actions,
  children,
}: {
  /** The checkbox field name. Must match the DataTable's `select.name`. */
  name: string;
  actions: BulkAction[];
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const boxes = () =>
    Array.from(
      form.current?.querySelectorAll<HTMLInputElement>(
        `input[type="checkbox"][name="${name}"]`,
      ) ?? [],
    );

  const selected = () => boxes().filter((box) => box.checked).map((box) => box.value);

  // Read off the DOM rather than mirrored into state: the boxes ARE the state,
  // and a mirror is one more thing that can disagree with what is on screen.
  const recount = () => setCount(selected().length);

  function toggleAll() {
    const all = boxes();
    const next = count < all.length;
    for (const box of all) box.checked = next;
    recount();
  }

  function run(action: BulkAction) {
    const ids = selected();
    if (ids.length === 0) return;
    if (action.confirm && !window.confirm(action.confirm(ids.length))) return;

    startTransition(async () => {
      const result = await action.run(ids);
      for (const box of boxes()) box.checked = false;
      setCount(0);
      router.refresh();
      toast({
        message: describe(result),
        tone: result.skipped?.length ? "info" : "success",
        duration: result.skipped?.length ? 8000 : 4000,
      });
    });
  }

  const total = boxes().length;

  return (
    <form
      ref={form}
      // No action and no method: nothing here submits. The buttons call server
      // actions directly with the ids, so the browser never navigates and the
      // toast survives to be read.
      onSubmit={(event) => event.preventDefault()}
      onChange={recount}
    >
      {children}

      {count > 0 ? (
        <ThumbBar desktop="sticky">
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {count} selected
              {total > 0 ? (
                <span className="text-[var(--color-ink-muted)]"> of {total}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={toggleAll}
              className="min-h-[var(--tap-min)] px-2 text-sm text-[var(--color-brand-600)] underline"
            >
              {count < total ? "Select all" : "Clear"}
            </button>

            <span className="flex-1" />

            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={pending}
                onClick={() => run(action)}
                className={`min-h-[var(--tap-min)] rounded-[var(--radius-control)] border px-4 text-sm font-medium disabled:opacity-50 ${
                  action.tone === "danger"
                    ? "border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </ThumbBar>
      ) : null}
    </form>
  );
}

/** One sentence, saying each thing that happened and nothing that did not. */
function describe(result: BulkResult): string {
  const parts: string[] = [];
  if (result.closed) parts.push(`${result.closed} closed`);
  if (result.archived) parts.push(`${result.archived} archived`);
  if (result.deleted) parts.push(`${result.deleted} deleted for good`);
  if (result.restored) parts.push(`${result.restored} back on the boards`);

  const skipped = result.skipped ?? [];
  if (skipped.length > 0) {
    // The reason, not just the count. "3 skipped" sends somebody hunting; "3
    // skipped — close the request first" is the next thing to do.
    const reasons = [...new Set(skipped.map((entry) => entry.reason))];
    parts.push(`${skipped.length} skipped — ${reasons.join("; ")}`);
  }

  return parts.length > 0 ? `${parts.join(", ")}.` : "Nothing to do.";
}
