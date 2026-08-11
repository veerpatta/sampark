import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — Sampark" };

/**
 * Admin sign-in. Teachers never see this page and never have an account —
 * principle 1. Accounts are created with `npm run db:create-user`, never
 * through a public sign-up.
 */
export default async function LoginPage() {
  const session = await currentUser();
  if (session) redirect("/");

  return (
    <div
      lang="en"
      className="flex min-h-screen items-center justify-center bg-[var(--color-surface-muted)] p-6"
    >
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-card">
        <h1 className="text-title font-semibold">Sampark</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          VPPS Data Desk — office sign in
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
