import { redirect } from "next/navigation";
import { canManageSettings, currentUser } from "@/lib/auth/session";
import { AdminNavBar, type NavItem } from "@/components/admin/AdminNav";
import { AppBar } from "@/components/admin/AppBar";
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
const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/requests", label: "Requests", icon: "requests" },
  { href: "/review", label: "Review", icon: "review" },
  // Marks sits beside Review rather than under it. They are the two halves of
  // "what came back": Review is what needs a decision, Marks is what does not.
  // Since marks stopped queueing there is no other screen that says a marks
  // round is in progress at all.
  { href: "/marks", label: "Marks", icon: "marks" },
  { href: "/students", label: "Students", icon: "students" },
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

  const nav: NavItem[] = canManageSettings(user.role)
    ? [
        ...NAV,
        {
          href: "/settings",
          match: "/settings",
          label: "Settings",
          icon: "settings",
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
      {/* The sign-out form is passed IN rather than rendered inside AppBar:
          AppBar is a client component (it reads the pathname for the crumb and
          the back link) and logoutAction is a server action bound to this
          module. Handing it down as a rendered node keeps it on the server. */}
      <AppBar
        nav={nav}
        userName={user.name}
        role={user.role}
        signOut={
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              Sign out
            </button>
          </form>
        }
      />
      {/* Clears the fixed nav on a phone, and nothing else — a page that also
          mounts a ThumbBar adds its own room on top. Expressed off the token
          rather than as a round number, so the two cannot drift apart. Nothing
          to clear on a desktop, where the nav is back in the header. */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-[calc(var(--admin-nav-h)+env(safe-area-inset-bottom)+1.5rem)] md:px-6 md:py-8 md:pb-8">
        {children}
      </main>
      <AdminNavBar items={nav} />
    </div>
  );
}
