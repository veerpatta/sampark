"use client";

import { useRef } from "react";
import Link from "next/link";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import {
  PAGE_SIZES,
  SORTS,
} from "@/lib/student-filters";
import type { StudentSort } from "@/lib/students";
import type { ChipGroup } from "./FilterBar";
import { btn, eyebrow, field, FOCUS } from "@/components/ui/controls";

const MOBILE_SORT_LABELS: Record<StudentSort, string> = {
  name: "Name",
  class: "Class and roll",
  recent: "Recently updated",
  complete: "Least complete",
  fullest: "Most complete",
  id: "Student ID",
};

/**
 * The students board's phone controls.
 *
 * Search and sort stay in reach; the long facet list does not sit between the
 * app bar and the first child. This is still one ordinary GET form, so Enter,
 * the Apply button, bookmarks and JavaScript-off filtering keep the same URL
 * contract as the desktop FilterBar.
 */
export function StudentMobileFilters({
  primary,
  secondary,
  search,
  sort,
  size,
}: {
  primary: ChipGroup[];
  secondary: ChipGroup[];
  search: string;
  sort: StudentSort;
  size: number;
}) {
  const form = useRef<HTMLFormElement>(null);
  const groups = [...primary, ...secondary];
  const active = groups.flatMap((group) =>
    group.selected.map((value) => {
      const option = group.values.find((entry) => entry.value === value);
      return {
        name: group.name,
        value,
        label: option?.label ?? value,
      };
    }),
  );

  const apply = () => form.current?.requestSubmit();

  function remove(name: string, value: string) {
    const controls = Array.from(form.current?.elements ?? []);
    const checkbox = controls.find(
      (control) =>
        control instanceof HTMLInputElement &&
        control.type === "checkbox" &&
        control.name === name &&
        control.value === value,
    );
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = false;
      apply();
    }
  }

  return (
    <form ref={form} method="get" className="space-y-3 md:hidden">
      <label className="block">
        <span className="sr-only">Search students</span>
        <span className="flex gap-2">
          <input
            name="q"
            defaultValue={search}
            placeholder="Name, ID, mobile, parent, village…"
            className={field()}
          />
          <button
            type="submit"
            aria-label="Search students"
            className={`${btn()} w-12 shrink-0 px-0`}
          >
            <MagnifyingGlass aria-hidden size={20} />
          </button>
        </span>
      </label>

      <div className="flex items-center gap-2">
        <details className="group min-w-0 flex-1">
          <summary
            className={`flex min-h-[var(--tap-min)] cursor-pointer list-none items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-semibold ${FOCUS}`}
          >
            Filters
            {active.length > 0 ? (
              <span className="ml-2 rounded-[var(--radius-chip)] bg-[var(--color-brand-50)] px-2 py-0.5 font-mono text-xs text-[var(--color-brand-700)]">
                {active.length}
              </span>
            ) : null}
          </summary>

          <div className="mt-3 space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-card">
            {primary.map((group) => (
              <MobileChips key={group.name} group={group} onChange={apply} />
            ))}

            {secondary.length > 0 ? (
              <details open={secondary.some((group) => group.selected.length > 0)}>
                <summary
                  className={`flex min-h-[var(--tap-min)] cursor-pointer list-none items-center text-sm font-medium text-[var(--color-brand-600)] ${FOCUS}`}
                >
                  More filters
                </summary>
                <div className="space-y-4 pt-2">
                  {secondary.map((group) => (
                    <MobileChips key={group.name} group={group} onChange={apply} />
                  ))}
                </div>
              </details>
            ) : null}

            <label className="block max-w-32">
              <span className={eyebrow()}>Per page</span>
              <select name="size" defaultValue={String(size)} className={`${field()} mt-1`}>
                {PAGE_SIZES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" className={btn({ full: true })}>
              Apply filters
            </button>
          </div>
        </details>

        <label className="min-w-0 flex-1">
          <span className="sr-only">Sort students</span>
          <select
            name="sort"
            defaultValue={sort}
            onChange={apply}
            className={field()}
            aria-label="Sort students"
          >
            {SORTS.map((value) => (
              <option key={value} value={value}>
                {MOBILE_SORT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {active.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {active.map((entry) => (
            <button
              key={`${entry.name}:${entry.value}`}
              type="button"
              onClick={() => remove(entry.name, entry.value)}
              aria-label={`Remove ${entry.label} filter`}
              className={`inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-chip)] border border-[var(--color-brand-600)] bg-[var(--color-brand-50)] px-3 text-sm font-medium text-[var(--color-brand-700)] ${FOCUS}`}
            >
              {entry.label}
              <X aria-hidden size={14} weight="bold" />
            </button>
          ))}
          <Link
            href="/students"
            className={`inline-flex min-h-9 items-center px-2 text-sm text-[var(--color-ink-muted)] underline ${FOCUS}`}
          >
            Clear all
          </Link>
        </div>
      ) : null}
    </form>
  );
}

function MobileChips({
  group,
  onChange,
}: {
  group: ChipGroup;
  onChange: () => void;
}) {
  if (group.values.length === 0) return null;

  return (
    <fieldset>
      <legend className={eyebrow()}>{group.label}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
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
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm peer-checked:border-[var(--color-brand-600)] peer-checked:bg-[var(--color-brand-50)] peer-checked:font-medium peer-checked:text-[var(--color-brand-700)] peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-brand-600)]">
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
