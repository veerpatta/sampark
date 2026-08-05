export const metadata = { title: "Sign in — Sampark" };

/**
 * Admin sign-in. Teachers never see this page and never have an account.
 *
 * TODO (Phase 1): wire to Auth.js v5 Credentials provider — bcrypt against
 * users.password_hash, 8-hour JWT session, secure httpOnly cookie.
 */
export default function LoginPage() {
  return (
    <div
      lang="en"
      className="flex min-h-screen items-center justify-center bg-[var(--color-surface-muted)] p-6"
    >
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <h1 className="text-xl font-semibold tracking-tight">Sampark</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          VPPS Data Desk — office sign in
        </p>
        <p className="mt-6 font-mono text-xs uppercase tracking-wider text-[var(--color-pending)]">
          Phase 1 · not built yet
        </p>
      </div>
    </div>
  );
}
