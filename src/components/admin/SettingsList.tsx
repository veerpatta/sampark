import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { card } from "@/components/ui/controls";

/**
 * A list of places to go, each with a line saying what is there.
 *
 * The note under each label is the whole point. "Field registry" and "Subjects"
 * mean nothing to somebody who did not build this; "What can be collected" and
 * "Who teaches what" mean something to the office. A settings index without
 * them is a menu you have to open every item of once to learn.
 *
 * Rows are 60px rather than 48px. They are a wall of near-identical targets and
 * the cost of hitting the wrong one is a page load — worth the extra 12px of
 * separation on a phone, which is where this gets used.
 *
 * Imported from /dist/ssr because this renders on the server: the default entry
 * is a client component and would otherwise pull React into the bundle for a
 * chevron.
 */
export function SettingsList({
  items,
}: {
  items: { href: string; label: string; note: string }[];
}) {
  return (
    <ul className={`${card()} overflow-hidden`}>
      {items.map((item) => (
        <li
          key={item.href}
          className="border-b border-[var(--color-border)] last:border-b-0"
        >
          <Link
            href={item.href}
            className="flex min-h-[60px] items-center gap-3 px-4 py-3 active:bg-[var(--color-surface-muted)] md:hover:bg-[var(--color-surface-muted)]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">
                {item.label}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                {item.note}
              </span>
            </span>
            <CaretRight
              aria-hidden
              size={16}
              weight="bold"
              className="shrink-0 text-[var(--color-ink-faint)]"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
