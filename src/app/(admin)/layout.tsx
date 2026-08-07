import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";
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
  { href: "/", label: "Home", icon: "◉" },
  { href: "/requests", label: "Requests", icon: "✉" },
  { href: "/review", label: "Review", icon: "✓" },
  { href: "/students", label: "Students", icon: "☰" },
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
    ? [
        ...NAV,
        {
          href: "/settings/teachers",
          match: "/settings",
          label: "Settings",
          icon: "⚙",
        },
      ]
    : NAV;

  return (
    // admin-surface is the hook for the 16px input rule in tokens.css. One
    // class here rather than a font-size on forty control class strings, and
    // the rule can then say WHY in one place.
    <div
      lang="en"
      className="admin-surface min-h-screen bg-[var(--color-surface-muted)]"
    >
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 md:px-6">
          <Link href="/" className="font-semibold tracking-tight">
            Sampark
          </Link>
          <AdminNav items={nav} />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-[var(--color-ink-muted)] sm:inline">
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
      {/* Clears the fixed nav on a phone, and nothing else — a page that also
          mounts a ThumbBar adds its own room on top. Expressed off the token
          rather than as a round number, so the two cannot drift apart. Nothing
          to clear on a desktop, where the nav is back in the header. */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-[calc(var(--admin-nav-h)+env(safe-area-inset-bottom)+1.5rem)] md:px-6 md:py-8 md:pb-8">
        {children}
      </main>
    </div>
  );
}
