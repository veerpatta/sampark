"use client";

import { useEffect, useState } from "react";
import { chip } from "@/components/ui/controls";

/**
 * Which columns the board shows, remembered per browser.
 *
 * DataTable stays a server component: it stamps `data-col` on every header and
 * cell, and this island emits a <style> that hides the ones the office has
 * switched off. No React state reaches the table, no re-render moves a row.
 * The phone cards are untouched — they carry no data-col — because a card is
 * already the short form.
 *
 * Renders its chips only after mount, so the server markup and the first
 * client paint agree; until then the table shows the defaults.
 */
export type PickableColumn = { key: string; header: string; defaultOn: boolean };

export function ColumnPicker({
  columns,
  storageKey,
  scope,
}: {
  columns: PickableColumn[];
  storageKey: string;
  /** A class on the table's wrapper, so the style reaches only this board. */
  scope: string;
}) {
  const [hidden, setHidden] = useState<Set<string> | null>(null);

  useEffect(() => {
    let stored: string[] | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      stored = raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      stored = null;
    }
    setHidden(
      new Set(
        stored ?? columns.filter((column) => !column.defaultOn).map((column) => column.key),
      ),
    );
  }, [columns, storageKey]);

  function toggle(key: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Nothing to do: the choice still applies for this page view.
      }
      return next;
    });
  }

  // Server render and first paint: the defaults, as CSS, so nothing flashes.
  const off = hidden ?? new Set(columns.filter((column) => !column.defaultOn).map((column) => column.key));

  return (
    <>
      <style>
        {[...off].map((key) => `.${scope} [data-col="${key}"]{display:none}`).join("")}
      </style>
      {hidden ? (
        <div className="hidden flex-wrap items-center gap-1.5 md:flex">
          <span className="mr-1 text-xs text-[var(--color-ink-muted)]">Columns</span>
          {columns.map((column) => (
            <button
              key={column.key}
              type="button"
              aria-pressed={!hidden.has(column.key)}
              onClick={() => toggle(column.key)}
              className={`${chip({ on: !hidden.has(column.key), pill: true })} min-h-8 px-2.5 text-xs`}
            >
              {column.header}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
