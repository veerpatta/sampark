"use client";

import { validateField } from "@/lib/fields";
import type { RowState, TeacherField, TeacherRosterRow } from "./types";

/**
 * One student, and the three things a teacher can say about them.
 *
 *   सही है   — what you have is right. One tap, and that is the common case.
 *   बदलें    — it is wrong, let me fix it.
 *   नहीं है  — this child is not in my class.
 *
 * The whole product rests on सही है being one tap. Checking 40 numbers is 40
 * taps and maybe 3 corrections; anything that adds a step to the confirm path
 * turns a five-minute job back into a forty-minute one.
 *
 * Marks-mode fields skip the confirm step entirely — there is nothing to
 * confirm when the school holds nothing — and open their inputs straight away.
 */
export function StudentRow({
  student,
  fields,
  state,
  collectMode,
  sent,
  onConfirm,
  onEdit,
  onAbsent,
  onChange,
  onDone,
  onReopen,
}: {
  student: TeacherRosterRow;
  fields: TeacherField[];
  state: RowState;
  collectMode: boolean;
  sent: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onAbsent: () => void;
  onChange: (fieldKey: string, value: string) => void;
  onDone: () => void;
  onReopen: () => void;
}) {
  const editing =
    state.status === "editing" || (collectMode && state.status === "todo");
  const showStored = state.status === "todo" && !collectMode;
  const showEntered = state.status === "edited";

  const invalid = fields.some((field) => {
    const value = state.values[field.key];
    if (value === undefined || value === "") return false;
    return !validateField(field, value).ok;
  });

  return (
    <li
      className={`rounded-[var(--radius-card)] border-2 p-4 ${
        {
          todo: "border-[var(--color-border)] bg-[var(--color-surface)]",
          editing: "border-[var(--color-correct-border)] bg-[var(--color-surface)]",
          confirmed:
            "border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)]",
          edited:
            "border-[var(--color-correct-border)] bg-[var(--color-correct-bg)]",
          absent:
            "border-[var(--color-absent-border)] bg-[var(--color-absent-bg)]",
        }[state.status]
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            {student.rollNo === null ? null : (
              <span className="font-mono text-sm text-[var(--color-ink-muted)]">
                {student.rollNo}.
              </span>
            )}
            <span className="text-lg font-medium">{student.name}</span>
          </div>
          {student.fatherName ? (
            <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
              पिता: {student.fatherName}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {sent ? (
            <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-confirm-fg)]">
              भेज दिया
            </span>
          ) : null}
          {state.status === "confirmed" ? (
            <span className="text-2xl text-[var(--color-confirm-fg)]" aria-label="सही है">
              ✓
            </span>
          ) : null}
          {state.status === "edited" ? (
            <span className="text-sm font-medium text-[var(--color-correct-fg)]">
              बदला गया
            </span>
          ) : null}
          {state.status === "absent" ? (
            <span className="text-sm font-medium text-[var(--color-absent-fg)]">
              नहीं है
            </span>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------- what the school holds now */}
      {showStored ? (
        <dl className="mt-3 space-y-2">
          {fields.map((field) => (
            <div
              key={field.key}
              className="flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] pt-2"
            >
              <dt className="text-sm text-[var(--color-ink-muted)]">
                {field.labelHi}
              </dt>
              <dd className="text-right text-base font-medium">
                {student.values[field.key] ? (
                  <span className={numeric(field) ? "font-mono" : ""}>
                    {student.values[field.key]}
                  </span>
                ) : (
                  <span className="text-[var(--color-warning)]">खाली है</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* ------------------------------------------------- what she just typed */}
      {showEntered ? (
        <dl className="mt-3 space-y-2">
          {fields.map((field) => {
            const entered = state.values[field.key];
            const stored = student.values[field.key];
            const changed = entered !== undefined && entered !== "" && entered !== stored;
            return (
              <div
                key={field.key}
                className="flex items-baseline justify-between gap-3 border-t border-[var(--color-correct-border)] pt-2"
              >
                <dt className="text-sm text-[var(--color-ink-muted)]">
                  {field.labelHi}
                </dt>
                <dd className="text-right text-base font-medium">
                  {changed ? (
                    <>
                      <span className="mr-2 text-sm line-through opacity-50">
                        {stored ?? "खाली"}
                      </span>
                      <span className={numeric(field) ? "font-mono" : ""}>
                        {entered}
                      </span>
                    </>
                  ) : (
                    <span className={numeric(field) ? "font-mono" : ""}>
                      {stored ?? "खाली है"}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}

      {/* --------------------------------------------------------- the inputs */}
      {editing ? (
        <div className="mt-3 space-y-3">
          {fields.map((field) => {
            const current =
              state.values[field.key] ?? student.values[field.key] ?? "";
            const check = validateField(field, current);
            const bad = current !== "" && !check.ok;

            return (
              <label key={field.key} className="block">
                <span className="text-sm text-[var(--color-ink-muted)]">
                  {field.labelHi}
                </span>
                {field.inputType === "select" ? (
                  <select
                    value={current}
                    onChange={(event) => onChange(field.key, event.target.value)}
                    className="mt-1 w-full rounded-lg border-2 border-[var(--color-border)] px-3"
                  >
                    <option value="">— चुनें —</option>
                    {optionsOf(field).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={current}
                    onChange={(event) => onChange(field.key, event.target.value)}
                    type={field.inputType === "date" ? "date" : "text"}
                    inputMode={numeric(field) ? "numeric" : "text"}
                    maxLength={field.exactLen ?? undefined}
                    className={`mt-1 w-full rounded-lg border-2 px-3 ${
                      bad
                        ? "border-[var(--color-danger)]"
                        : "border-[var(--color-border)]"
                    } ${numeric(field) ? "font-mono" : ""}`}
                  />
                )}
                {bad && !check.ok ? (
                  <span
                    role="alert"
                    className="mt-1 block text-sm font-medium text-[var(--color-danger)]"
                  >
                    {check.errorHi}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : null}

      {/* -------------------------------------------------------- the actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {state.status === "todo" && !collectMode ? (
          <>
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 rounded-lg border-2 border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 font-semibold text-[var(--color-confirm-fg)]"
            >
              सही है
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="flex-1 rounded-lg border-2 border-[var(--color-correct-border)] bg-[var(--color-correct-bg)] px-4 font-semibold text-[var(--color-correct-fg)]"
            >
              बदलें
            </button>
          </>
        ) : null}

        {editing ? (
          <button
            type="button"
            onClick={onDone}
            disabled={invalid}
            className="flex-1 rounded-lg border-2 border-[var(--color-confirm-border)] bg-[var(--color-confirm-bg)] px-4 font-semibold text-[var(--color-confirm-fg)] disabled:opacity-40"
          >
            हो गया
          </button>
        ) : null}

        {state.status === "confirmed" ||
        state.status === "edited" ||
        state.status === "absent" ? (
          <button
            type="button"
            onClick={onReopen}
            className="rounded-lg border-2 border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-ink-muted)]"
          >
            फिर से देखें
          </button>
        ) : null}

        {state.status !== "absent" ? (
          <button
            type="button"
            onClick={onAbsent}
            className="px-3 text-sm text-[var(--color-absent-fg)] underline"
          >
            नहीं है
          </button>
        ) : null}
      </div>
    </li>
  );
}

const numeric = (field: TeacherField) =>
  field.inputType === "tel" || field.inputType === "number";

function optionsOf(field: TeacherField): string[] {
  return Array.isArray(field.options) ? field.options.map(String) : [];
}
