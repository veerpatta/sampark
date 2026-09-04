"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CaretLeft, UserCircle } from "@phosphor-icons/react";
import { AdminNavLinks, type NavItem } from "./AdminNav";
import { CommandPalette } from "./CommandPalette";

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
  ["/marks/grid", "Marks grid"],
  ["/marks", "Marks"],
  ["/students/import", "Import students"],
  ["/students/new", "Add student"],
  ["/students/health", "Data health"],
  ["/students", "Students"],
  ["/settings/teachers", "Teachers"],
  ["/settings/subjects", "Subjects"],
  ["/settings/fields", "Field registry"],
  ["/settings/users", "Admin users"],
  ["/settings/audit", "Audit log"],
  ["/settings/whatsapp", "WhatsApp"],
  ["/settings", "Settings"],
];

/** The five screens the bottom bar goes to. Nothing above these to go back to. */
const ROOTS = new Set(["/", "/requests", "/review", "/marks", "/students", "/settings"]);

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
  const settings = nav.find((item) => item.href === "/settings");
  const [accountOpen, setAccountOpen] = useState(false);
  const account = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountPanel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    accountPanel.current?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!account.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setAccountOpen(false);
      accountButton.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

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
        <span className="ml-auto flex shrink-0 items-center text-xs text-[var(--color-ink-muted)]">
          <CommandPalette compact />
          <span ref={account} className="relative">
            <button
              ref={accountButton}
              type="button"
              aria-label="Account menu"
              aria-expanded={accountOpen}
              aria-haspopup="dialog"
              onClick={() => setAccountOpen((open) => !open)}
              className="-mr-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-ink-muted)] active:bg-[var(--color-surface-muted)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand-600)]"
            >
              <UserCircle aria-hidden size={24} />
            </button>
            {accountOpen ? (
              <div
                ref={accountPanel}
                role="dialog"
                aria-label="Account"
                tabIndex={-1}
                className="absolute right-0 top-[calc(100%+0.25rem)] w-64 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-raised"
              >
                <div className="border-b border-[var(--color-border)] px-4 py-3">
                  <p className="truncate text-sm font-medium text-[var(--color-ink)]">
                    {userName}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
                    {role}
                  </p>
                </div>
                {settings ? (
                  <Link
                    href={settings.href}
                    onClick={() => setAccountOpen(false)}
                    className="flex min-h-[var(--tap-min)] items-center px-4 text-sm text-[var(--color-ink)] active:bg-[var(--color-surface-muted)]"
                  >
                    Settings
                  </Link>
                ) : null}
                <div className="border-t border-[var(--color-border)] text-sm">
                  {signOut}
                </div>
              </div>
            ) : null}
          </span>
        </span>
      </div>

      {/* ---------------------------------------------------- desktop bar */}
      <div className="mx-auto hidden max-w-6xl items-center gap-6 px-4 py-4 md:flex md:px-6 xl:max-w-7xl">
        <Link href="/" className="font-semibold tracking-tight">
          Sampark
        </Link>
        <AdminNavLinks items={nav} />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <CommandPalette />
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
