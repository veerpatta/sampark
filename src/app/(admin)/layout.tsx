import Link from "next/link";

/**
 * Admin console shell. English UI — only the teacher surface is Hindi-first.
 *
 * TODO (Phase 1): guard this layout with the Auth.js session and redirect to
 * /login when absent. Nothing under (admin) is public.
 */
const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/requests", label: "Requests" },
  { href: "/review", label: "Review" },
  { href: "/students", label: "Students" },
  { href: "/settings/fields", label: "Settings" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div lang="en" className="min-h-screen bg-[var(--color-surface-muted)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            Sampark
          </Link>
          <nav className="flex gap-5 text-sm text-[var(--color-ink-muted)]">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:text-[var(--color-ink)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
