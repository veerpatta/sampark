"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckCircle,
  Gear,
  House,
  PaperPlaneTilt,
  Users,
  type Icon,
} from "@phosphor-icons/react";

/**
 * The admin's navigation, in the place a thumb can reach it.
 *
 * The office will mostly use this standing in a corridor, on a phone, to fire
 * off a WhatsApp link. So below `md` the nav is a fixed bar at the BOTTOM: a
 * top bar on a phone is a row of small targets at the far end of a stretch,
 * and it competes with the browser's own chrome for the same strip.
 *
 * At `md` and up it goes back to being a row of links inside the header,
 * because on a desktop the bottom of a 1400px window is nowhere near the
 * pointer.
 *
 * TWO EXPORTS, NOT ONE COMPONENT THAT RENDERS BOTH. They now live in different
 * places in the tree — the links sit inside the header's desktop half, which
 * is `hidden md:flex`, and a fixed bar nested inside a hidden container is
 * also hidden. Splitting them is what lets each be mounted where it belongs.
 *
 * Real <Link>s, so Next prefetches each destination as it enters the viewport
 * — on a bottom bar that means all of them, immediately.
 */

/**
 * Icons arrive as a NAME, not as a component.
 *
 * These are client components and the layout that mounts them is a server one,
 * so a component reference cannot cross between them — React has to serialise
 * the props and there is no wire format for a function. The name is a string,
 * the lookup happens on this side, and the icons are only ever pulled into the
 * client bundle from here.
 *
 * Phosphor rather than the ◉ ✉ ✓ ☰ ⚙ that used to be typed inline: those are
 * ordinary characters, so what the office actually saw was whichever glyph
 * their phone's fallback font happened to carry, at whatever size and weight
 * that font drew it. design-qa.md already ruled glyph and emoji substitutes
 * out on the teacher surface; this closes the console side.
 */
export type NavIcon = "home" | "requests" | "review" | "students" | "settings";

const ICONS: Record<NavIcon, Icon> = {
  home: House,
  requests: PaperPlaneTilt,
  review: CheckCircle,
  students: Users,
  settings: Gear,
};

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /**
   * Prefix that counts as "you are here", when it is broader than the href.
   * Settings links to its index but stays lit across all six of its pages.
   */
  match?: string;
};

function useIsActive() {
  const pathname = usePathname();
  return (item: NavItem) => {
    const prefix = item.match ?? item.href;
    return prefix === "/" ? pathname === "/" : pathname.startsWith(prefix);
  };
}

/** Desktop: a row of text links, mounted inside the header. */
export function AdminNavLinks({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  return (
    <nav aria-label="Main" className="flex gap-5 text-sm text-[var(--color-ink-muted)]">
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
  );
}

/** Phone: a bar fixed to the bottom of the viewport. */
export function AdminNavBar({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  return (
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
          const Glyph = ICONS[item.icon];
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] ${
                  active
                    ? "font-semibold text-[var(--color-brand-600)]"
                    : "text-[var(--color-ink-muted)]"
                }`}
              >
                {/* Weight, not colour, carries the second half of "you are
                    here" — a filled icon still reads as selected on a screen
                    washed out by daylight, where the blue does not. */}
                <Glyph
                  aria-hidden
                  size={22}
                  weight={active ? "fill" : "regular"}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
