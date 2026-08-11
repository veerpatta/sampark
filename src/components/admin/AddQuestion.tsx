"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAdhocField } from "@/app/(admin)/requests/adhoc-actions";

/**
 * "Ask something that isn't on the list."
 *
 * The field registry already made "what can be collected" data rather than
 * code — adding a field has always been a row, not a deployment. What it did
 * not do was let the office add one at the moment she needs it, from a phone,
 * without being an owner and without understanding target columns.
 *
 * An inline panel, not a modal: the repo has no modals, and the reason given
 * for that holds here too — she is in the middle of building a request and
 * covering it up to ask her four questions loses her place.
 *
 * The copy is doing real work. A question added here can never change a student
 * record, and saying so is what makes it safe to leave at office level.
 */
const TYPES = [
  { value: "text", label: "Text", hint: "a name, a note" },
  { value: "number", label: "Number", hint: "a count, a size" },
  { value: "select", label: "Dropdown", hint: "one of a fixed list" },
  { value: "boolean", label: "Yes / no", hint: "हाँ or नहीं" },
  { value: "date", label: "Date", hint: "" },
  { value: "tel", label: "Phone", hint: "" },
];

export function AddQuestion({ onAdded }: { onAdded: (key: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [labelEn, setLabelEn] = useState("");
  const [labelHi, setLabelHi] = useState("");
  const [inputType, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [maxValue, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    const result = await createAdhocField({
      labelEn,
      labelHi,
      inputType,
      options,
      maxValue,
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    onAdded(result.field.key);
    setOpen(false);
    setLabelEn("");
    setLabelHi("");
    setOptions("");
    setMax("");
    setType("text");
    // The field list on this page came from the server, so it has to be told.
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] border-2 border-dashed border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-ink-muted)] transition-transform active:scale-[0.98]"
      >
        ＋ Ask something else
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-brand-600)] bg-[var(--color-brand-50)] p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">A one-off question</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-label text-[var(--color-ink-muted)] underline"
        >
          cancel
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Question (English)"
          value={labelEn}
          onChange={setLabelEn}
          placeholder="T-shirt size"
        />
        <Field
          label="Question (Hindi) — the teacher reads this"
          value={labelHi}
          onChange={setLabelHi}
          placeholder="टी-शर्ट साइज़"
          lang="hi"
        />
      </div>

      <p className="mt-3 text-xs font-medium text-[var(--color-ink-muted)]">
        Answer type
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        {TYPES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setType(option.value)}
            title={option.hint}
            className={`min-h-[var(--tap-min)] rounded-[var(--radius-control)] border px-3 text-sm transition-transform active:scale-[0.98] ${
              inputType === option.value
                ? "border-[var(--color-brand-600)] bg-[var(--color-surface)] font-medium text-[var(--color-brand-700)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {inputType === "select" ? (
        <div className="mt-3">
          <Field
            label="Choices, comma separated"
            value={options}
            onChange={setOptions}
            placeholder="S, M, L, XL"
          />
        </div>
      ) : null}

      {inputType === "number" ? (
        <div className="mt-3">
          <Field
            label="Highest allowed (optional)"
            value={maxValue}
            onChange={setMax}
            placeholder="25"
          />
        </div>
      ) : null}

      <p className="mt-3 text-label text-[var(--color-ink-muted)]">
        This never changes a student record. Answers are stored against this
        request, and you can export them from it.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || !labelEn.trim() || !labelHi.trim()}
        className="mt-3 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] bg-[var(--color-brand-600)] px-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add this question"}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  lang,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  lang?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        value={value}
        lang={lang}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 min-h-[var(--tap-min)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-brand-600)]"
      />
    </label>
  );
}
