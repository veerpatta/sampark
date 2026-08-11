"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretLeft } from "@phosphor-icons/react";
import { AdminNavLinks, type NavItem } from "./AdminNav";

/**
 * The bar across the top of the console.
 *
 * It is two different bars. At `md` and up it is what it has always been — the
 * wordmark, the nav links, who you are signed in as. Below `md` the nav has
 * moved to the bottom of the screen where a thumb is, which used to leave the
 * top strip holding a wordmark and nothing else: a fixed 56px of the most
 * valuable space on a phone spent telling the office the name of the app they
 * just opened.
 *
 * So on a phone it says where you are instead, and how to get back out. Those
 * are the two questions a console with fifteen screens and a five-tab bar
 * actually raises.
 */

/**
 * What to call each screen in the crumb.
 *
 * Longest prefix wins, so /students/import is "Import" rather than "Students".
 * Deliberately not derived from the URL segment: the segment for the audit log
 * is "audit", and half of these are ids.
 */
const CRUMBS: [prefix: string, label: string][] = [
  ["/requests/new", "New request"],
  ["/requests/bulk", "Send to many"],
  ["/requests/batch", "Send queue"],
  ["/requests", "Requests"],
  ["/review", "Review"],
  ["/students/import", "Import students"],
  ["/students", "Students"],
  ["/settings/teachers", "Teachers"],
  ["/settings/subjects", "Subjects"],
  ["/settings/fields", "Field registry"],
  ["/settings/users", "Admin users"],
  ["/settings/audit", "Audit log"],
  ["/settings", "Settings"],
];

/** The five screens the bottom bar goes to. Nothing above these to go back to. */
const ROOTS = new Set(["/", "/requests", "/review", "/students", "/settings"]);

function crumbFor(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const hit = CRUMBS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return hit?.[1] ?? "Sampark";
}

/**
 * A real <Link> to the parent section, not history.back().
 *
 * Back() is wrong here often enough to matter: the office opens these from a
 * WhatsApp message on their own phone, so the previous entry is frequently
 * WhatsApp, or a request they were sent last week, or nothing at all. A link
 * to the section above always goes somewhere sensible, Next prefetches it, and
 * it survives a page opened in a new tab.
 */
function parentOf(pathname: string): string | null {
  if (ROOTS.has(pathname)) return null;
  const [, first] = pathname.split("/");
  return first ? `/${first}` : null;
}

export function AppBar({
  nav,
  userName,
  role,
  signOut,
}: {
  nav: NavItem[];
  userName: string;
  role: string;
  /** The sign-out form, rendered on the server so the action stays server-side. */
  signOut: React.ReactNode;
}) {
  const pathname = usePathname();
  const parent = parentOf(pathname);
  const crumb = crumbFor(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)] md:static">
      {/* ------------------------------------------------------ phone bar */}
      <div className="flex h-[var(--app-bar-h)] items-center gap-2 px-4 md:hidden">
        {parent ? (
          <Link
            href={parent}
            aria-label="Back"
            className="-ml-2 flex h-10 w-8 items-center text-[var(--color-ink-muted)]"
          >
            <CaretLeft aria-hidden size={20} weight="bold" />
          </Link>
        ) : null}
        {/* The crumb, not an <h1>. Every screen already has its own heading a
            few pixels below this; two h1s saying almost the same thing is a
            worse outline for a screen reader than one. */}
        <span className="truncate text-[17px] font-semibold tracking-[-0.01em]">
          {crumb}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
          <span className="max-w-24 truncate">{userName}</span>
          <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[11px]">
            {role}
          </span>
        </span>
      </div>

      {/* ---------------------------------------------------- desktop bar */}
      <div className="mx-auto hidden max-w-6xl items-center gap-6 px-4 py-4 md:flex md:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Sampark
        </Link>
        <AdminNavLinks items={nav} />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-[var(--color-ink-muted)]">
            {userName}
            <span className="ml-1.5 rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-xs">
              {role}
            </span>
          </span>
          {signOut}
        </div>
      </div>
    </header>
  );
}
