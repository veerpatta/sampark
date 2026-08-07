"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The admin's navigation, in the place a thumb can reach it.
 *
 * The office will mostly use this standing in a corridor, on a phone, to fire
 * off a WhatsApp link. So below `md` the nav is a fixed bar at the BOTTOM: a
 * top bar on a phone is a row of small targets at the far end of a stretch,
 * and it competes with the browser's own chrome for the same strip.
 *
 * At `md` and up it goes back to being a top bar, because on a desktop the
 * bottom of a 1400px window is nowhere near the pointer.
 *
 * Real <Link>s, so Next prefetches each destination as it enters the viewport
 * — on a bottom bar that means all of them, immediately.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /**
   * Prefix that counts as "you are here", when it is broader than the href.
   * Settings links to its first page but stays lit across all four of them.
   */
  match?: string;
};

export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  const isActive = (item: NavItem) => {
    const prefix = item.match ?? item.href;
    return prefix === "/" ? pathname === "/" : pathname.startsWith(prefix);
  };

  return (
    <>
      {/* ------------------------------------------------ desktop: a top bar */}
      <nav className="hidden gap-5 text-sm text-[var(--color-ink-muted)] md:flex">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item) ? "page" : undefined}
            className={
              isActive(item)
                ? "font-medium text-[var(--color-ink)]"
                : "hover:text-[var(--color-ink)]"
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* --------------------------------------------- phone: a bottom bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {/* The bar IS --admin-nav-h, it is not merely close to it. Everything
            else fixed to the bottom of a phone offsets by that token, so the
            two must be the same number by construction rather than by someone
            re-measuring this after a padding change. It is above --tap-min. */}
        <ul className="flex h-[var(--admin-nav-h)]">
          {items.map((item) => {
            const active = isActive(item);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs ${
                    active
                      ? "font-semibold text-[var(--color-brand-600)]"
                      : "text-[var(--color-ink-muted)]"
                  }`}
                >
                  <span aria-hidden className="text-base leading-none">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
