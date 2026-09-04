"use client";

import { useState, useTransition } from "react";
import { btn, field } from "@/components/ui/controls";
import {
  LANGUAGES,
  LANGUAGE_LABEL,
  TEMPLATE_BUTTON_BASE,
  TEST_SUFFIX,
  type Language,
} from "@/lib/whatsapp-templates";
import { sendTestViaApi } from "./actions";

/**
 * Send the request template, with invented values, to a number typed here.
 *
 * The number is typed each time and never remembered: this is a proving
 * tool for the owner's own phone, not a way to message anybody.
 */
export function TestSend({ enabled }: { enabled: boolean }) {
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<Language>("hi");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function send() {
    setNote(null);
    startTransition(async () => {
      const outcome = await sendTestViaApi(phone, language);
      setNote(
        outcome.ok
          ? {
              ok: true,
              text: `Sent. The button on it opens ${TEMPLATE_BUTTON_BASE}${TEST_SUFFIX}.${
                outcome.warning ? ` ${outcome.warning}` : ""
              }`,
            }
          : { ok: false, text: outcome.error },
      );
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            Mobile number (10 digits)
          </span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="numeric"
            placeholder="9XXXXXXXXX"
            className={`${field()} mt-1`}
          />
        </label>
        <fieldset>
          <legend className="text-xs font-medium text-[var(--color-ink-muted)]">
            Language
          </legend>
          <div className="mt-1 flex gap-2">
            {LANGUAGES.map((option) => (
              <label key={option} className="cursor-pointer">
                <input
                  type="radio"
                  name="test-language"
                  value={option}
                  checked={language === option}
                  onChange={() => setLanguage(option)}
                  className="peer sr-only"
                />
                <span className="flex min-h-[var(--tap-min)] items-center rounded-[var(--radius-chip)] border border-[var(--color-border)] px-4 text-sm peer-checked:border-[var(--color-brand-600)] peer-checked:bg-[var(--color-brand-50)] peer-checked:font-medium peer-checked:text-[var(--color-brand-700)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-brand-600)]">
                  {LANGUAGE_LABEL[option]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <button
        type="button"
        onClick={send}
        disabled={!enabled || pending}
        className={`${btn({ tone: "go" })} w-full disabled:opacity-60 md:w-auto`}
      >
        {pending ? "Sending…" : "Send a test message"}
      </button>

      {!enabled ? (
        <p className="text-meta text-[var(--color-ink-muted)]">
          Set AISENSY_API_KEY on this deployment to send.
        </p>
      ) : null}

      {note ? (
        <p
          className={`text-sm ${
            note.ok ? "text-[var(--color-confirm-fg)]" : "text-[var(--color-danger)]"
          }`}
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
