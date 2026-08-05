import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { logoutAction } from "../login/actions";

/**
 * Admin console shell. English UI — only the teacher surface is Hindi-first.
 *
 * This layout is the gate for everything under (admin). Student names, phone
 * numbers and Aadhaar numbers are behind it, so the redirect below is not a
 * convenience — it is the only thing between that data and the open internet.
 *
 * A layout does NOT protect route handlers. Anything under /api that touches
 * data calls requireUser() from lib/auth/session.ts for itself.
 */
const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/requests", label: "Requests" },
  { href: "/review", label: "Review" },
  { href: "/students", label: "Students" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // currentUser, not auth(): a session token stays valid for its full 8 hours,
  // so an account deleted or deactivated five minutes ago would otherwise still
  // be walking around in here.
  const user = await currentUser();
  if (!user) redirect("/login");

  const nav = canManageSettings(user.role)
    ? [...NAV, { href: "/settings/teachers", label: "Settings" }]
    : NAV;

  return (
    <div lang="en" className="min-h-screen bg-[var(--color-surface-muted)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            Sampark
          </Link>
          <nav className="flex gap-5 text-sm text-[var(--color-ink-muted)]">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:text-[var(--color-ink)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-[var(--color-ink-muted)]">
              {user.name}
              <span className="ml-1.5 rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-xs">
                {user.role}
              </span>
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
