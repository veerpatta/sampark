"use client";

import { useState, useTransition } from "react";
import { btn, chip, field } from "@/components/ui/controls";
import { useToast } from "@/components/ui/Toast";
import { saveOfficeNumber } from "./actions";

/**
 * The number every master link goes to.
 *
 * A client form rather than a bare server action, for one reason: a bad number
 * has to say so on this screen. The action returns a message instead of
 * throwing, because "9 digits" is a thing to fix, not an error page.
 */
export function OfficeForm({
  office,
}: {
  office: { name: string; phone: string; language: string } | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const show = useToast();

  return (
    <form
      action={(formData) =>
        start(async () => {
          const result = await saveOfficeNumber(formData);
          setError(result.error);
          if (result.ok) show({ message: "Office number saved." });
        })
      }
      className="mt-4 space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-label font-medium">Name</span>
          <input
            name="name"
            defaultValue={office?.name ?? "Office"}
            className={`${field()} mt-1`}
            required
          />
          <span className="mt-1 block text-meta text-[var(--color-ink-muted)]">
            How the WhatsApp message greets whoever opens it.
          </span>
        </label>

        <label className="block">
          <span className="text-label font-medium">Phone</span>
          <input
            name="phone"
            defaultValue={office?.phone ?? ""}
            placeholder="9XXXXXXXXX"
            inputMode="numeric"
            className={`${field({ invalid: Boolean(error) })} mt-1 font-mono`}
            required
          />
          <span className="mt-1 block text-meta text-[var(--color-ink-muted)]">
            Ten digits, no country code. The API adds 91.
          </span>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Message language</legend>
        {/*
         * Chips over bare radios, for the reason the teacher editor uses them:
         * a 13px radio beside a 13px word is a 13px target, and this screen is
         * worked from a phone. The radio is still the control — it is
         * `sr-only` under a `<label>`, so the keyboard and a screen reader get
         * the real thing and a thumb gets 44px of it. Same pattern as
         * FilterBar.
         */}
        <div className="mt-2 flex gap-2">
          {(["hi", "en"] as const).map((code) => (
            <label key={code} className="flex-1 sm:flex-none">
              <input
                type="radio"
                name="language"
                value={code}
                defaultChecked={(office?.language ?? "hi") === code}
                className="peer sr-only"
              />
              <span
                className={`${chip()} w-full cursor-pointer peer-checked:border-[var(--color-brand-600)] peer-checked:bg-[var(--color-brand-50)] peer-checked:text-[var(--color-brand-600)] peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-brand-600)]`}
              >
                {code === "hi" ? "Hindi" : "English"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p className="text-sm text-[var(--color-danger-fg)]">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={`${btn({ tone: "primary", full: true })} sm:w-auto`}
      >
        {pending ? "Saving…" : office ? "Save" : "Set the office number"}
      </button>
    </form>
  );
}
