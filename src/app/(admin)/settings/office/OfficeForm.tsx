"use client";

import { useState, useTransition } from "react";
import { btn, field } from "@/components/ui/controls";
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
        <legend className="text-label font-medium">Message language</legend>
        <div className="mt-1 flex gap-3">
          {(["hi", "en"] as const).map((code) => (
            <label key={code} className="flex items-center gap-2">
              <input
                type="radio"
                name="language"
                value={code}
                defaultChecked={(office?.language ?? "hi") === code}
              />
              <span className="text-sm">{code === "hi" ? "Hindi" : "English"}</span>
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
        className={`${btn({ tone: "primary" })} w-full md:w-auto`}
      >
        {pending ? "Saving…" : office ? "Save" : "Set the office number"}
      </button>
    </form>
  );
}
