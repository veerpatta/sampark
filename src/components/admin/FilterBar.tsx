"use client";

import { useRef } from "react";

/**
 * Every way to narrow the school down, as chips you can tap.
 *
 * A CHECKBOX IN A GET FORM, DRESSED AS A CHIP. The `peer sr-only` +
 * `peer-checked:` pattern already used in settings/teachers, so the state lives
 * in the form and therefore in the URL, and the whole board works with
 * JavaScript switched off — Apply is a real submit button, not a fallback.
 * Selecting a chip auto-submits when JavaScript is available; that is the only
 * thing the script adds.
 *
 * THE COUNT ON EACH CHIP IS NOT DECORATION. "Rana Pratap 38" tells you the
 * house covers a third of the class before you filter to it and wonder where
 * everyone went. Houses and routes are sparse in this school — a third and a
 * half of the roll respectively — and the number is what makes that visible.
 *
 * The dimensions the office reaches for daily are on top; the rest live behind
 * a disclosure, because fourteen chip groups on a phone is not a filter bar,
 * it is a wall.
 */

export type ChipGroup = {
  /** Query-string parameter this group writes. */
  name: string;
  label: string;
  values: { value: string; label?: string; count?: number }[];
  selected: string[];
};

export function FilterBar({
  primary,
  secondary,
  children,
}: {
  /** Always visible. Class, house, and the missing-field chips. */
  primary: ChipGroup[];
  /** Behind "More filters". */
  secondary: ChipGroup[];
  /** Search box, sort and page size — rendered by the page, inside this form. */
  children?: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const anySecondary = secondary.some((group) => group.selected.length > 0);

  // Submitting on change is what makes a chip feel like a filter rather than a
  // form field. requestSubmit, not submit, so the browser still runs the form's
  // own validation and fires the submit event.
  const apply = () => form.current?.requestSubmit();

  return (
    <form ref={form} method="get" className="space-y-4">
      {children}

      {primary.map((group) => (
        <Chips key={group.name} group={group} onChange={apply} />
      ))}

      {secondary.length > 0 ? (
        <details open={anySecondary} className="rounded-lg">
          <summary className="inline-flex min-h-[var(--tap-min)] cursor-pointer items-center text-sm font-medium text-[var(--color-brand-600)]">
            More filters
            {anySecondary ? (
              <span className="ml-2 rounded-full bg-[var(--color-brand-50)] px-2 py-0.5 text-xs">
                in use
              </span>
            ) : null}
          </summary>
          <div className="mt-3 space-y-4">
            {secondary.map((group) => (
              <Chips key={group.name} group={group} onChange={apply} />
            ))}
          </div>
        </details>
      ) : null}

      {/* The no-JavaScript path, and the keyboard one. Never hidden. */}
      <button
        type="submit"
        className="min-h-[var(--tap-min)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
      >
        Apply filters
      </button>
    </form>
  );
}

function Chips({ group, onChange }: { group: ChipGroup; onChange: () => void }) {
  if (group.values.length === 0) return null;

  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-muted)]">
        {group.label}
      </legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {group.values.map((entry) => (
          <label key={entry.value} className="cursor-pointer">
            <input
              type="checkbox"
              name={group.name}
              value={entry.value}
              defaultChecked={group.selected.includes(entry.value)}
              onChange={onChange}
              className="peer sr-only"
            />
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm peer-checked:border-[var(--color-brand-600)] peer-checked:bg-[var(--color-brand-50)] peer-checked:font-medium peer-checked:text-[var(--color-brand-700)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-brand-600)]">
              {entry.label ?? entry.value}
              {entry.count !== undefined ? (
                <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                  {entry.count}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
