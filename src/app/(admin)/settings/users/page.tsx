import Link from "next/link";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageSettings, currentUser, ROLES } from "@/lib/auth/session";
import { saveUser, setUserActive } from "./actions";

export const metadata = { title: "Admin users — Sampark" };
export const dynamic = "force-dynamic";

/**
 * Admin console accounts. Owner only.
 *
 * Teachers are not here and never will be — a tokenised link is their entire
 * onboarding (principle 1). This screen is for the three to five office people
 * who can see student data.
 */
export default async function UsersPage() {
  const session = await currentUser();
  if (!session || !canManageSettings(session.role)) redirect("/");

  const users = await db
    .select()
    .from(schema.users)
    .orderBy(asc(schema.users.name));

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-display font-semibold tracking-tight">Admin users</h1>
          <Link
            href="/settings/teachers"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            teachers
          </Link>
          <Link
            href="/settings/fields"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            field registry
          </Link>
          <Link
            href="/settings/audit"
            className="text-sm text-[var(--color-brand-600)] hover:underline"
          >
            audit log
          </Link>
        </div>
        <p className="mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]">
          <strong>owner</strong> can do everything including this page.{" "}
          <strong>admin</strong> can create requests, import students and
          approve changes into the master record. <strong>office</strong> can
          create requests and view everything, but cannot approve or import.
          Teachers never have an account.
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Add a user, or reset a password
        </h2>
        <form action={saveUser} className="mt-4 grid gap-3 sm:grid-cols-5">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-600)]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Name
            </span>
            <input
              name="name"
              required
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-600)]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Role
            </span>
            <select
              name="role"
              defaultValue="office"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              Password
            </span>
            <input
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-600)]"
            />
          </label>

          <div className="sm:col-span-5">
            <button
              type="submit"
              className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
            >
              Save user
            </button>
            <span className="ml-3 text-xs text-[var(--color-ink-muted)]">
              An existing email updates that person — including their password.
              At least 10 characters.
            </span>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Since</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className={`border-b border-[var(--color-border)] last:border-0 ${
                  user.active ? "" : "opacity-50"
                }`}
              >
                <td className="px-4 py-2 font-medium">
                  {user.name}
                  {user.id === session.id ? (
                    <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                      (you)
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{user.email}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs">
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--color-ink-muted)]">
                  {user.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-2 text-right">
                  {user.id === session.id ? (
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      —
                    </span>
                  ) : (
                    <form action={setUserActive}>
                      <input type="hidden" name="id" value={user.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={user.active ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        className="text-xs text-[var(--color-ink-muted)] hover:underline"
                      >
                        {user.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-[var(--color-ink-muted)]">
        Users are deactivated, never deleted — the audit log names who approved
        each change, and a log that cannot name them is not a log. Deactivating
        takes effect immediately rather than when their session expires.
      </p>
    </div>
  );
}
