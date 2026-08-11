"use client";

import { useActionState } from "react";
import { btn } from "@/components/ui/controls";
import { loginAction } from "./actions";

export function LoginForm() {
  const [error, formAction, pending] = useActionState(loginAction, null);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-base outline-none focus:border-[var(--color-brand-600)]"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-base outline-none focus:border-[var(--color-brand-600)]"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={btn({ shape: "commit", tone: "primary", full: true })}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
