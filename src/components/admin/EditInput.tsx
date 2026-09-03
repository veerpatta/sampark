import Link from "next/link";
import { field } from "@/components/ui/controls";
import type { EditField } from "@/lib/student-edit";

/**
 * One box on a student form, with everything that is said underneath it.
 *
 * Lifted out of StudentEditForm so the new-student form and the bulk bar draw
 * the same control from the same EditField — one place decides that a phone is
 * a numeric keypad and a date is a date picker.
 *
 * TYPE-ONLY IMPORT FROM lib/student-edit. That module reaches node:crypto
 * through IMPORT_COLUMNS; a value import here would drag a polyfill of it into
 * the console bundle.
 */
export function EditInput({
  spec,
  error,
  pending,
  hint,
  idPrefix = "edit",
  name,
  required,
  autoFocus,
}: {
  spec: EditField;
  error?: string;
  /** A teacher's correction is waiting in /review on this very field. */
  pending?: string;
  /** Where the current value came from — one muted line. */
  hint?: string | null;
  idPrefix?: string;
  /** Defaults to the column; the bulk bar names its one input differently. */
  name?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const id = `${idPrefix}-${spec.column}`;

  return (
    <label className="block" htmlFor={id}>
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">
        {spec.label}
        {required ? <span aria-hidden> *</span> : null}
      </span>

      {spec.control === "select" ? (
        <select
          id={id}
          name={name ?? spec.column}
          defaultValue={spec.value}
          className={`mt-1 ${field({ invalid: Boolean(error) })}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          autoFocus={autoFocus}
        >
          {/* Present even on a NOT NULL column: leaving it out would make the
              first option a silent default for a field nobody has set. The
              server refuses an empty value where the column cannot take one. */}
          <option value="">—</option>
          {spec.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={name ?? spec.column}
          type={spec.control === "date" ? "date" : "text"}
          // `tel` and `number` as inputMode rather than as type: type="number"
          // brings spinners and silently drops a leading zero, and type="tel"
          // gives no validation this form is not already doing on the server.
          inputMode={
            spec.control === "tel" || spec.control === "number" ? "numeric" : undefined
          }
          autoComplete="off"
          defaultValue={spec.value}
          className={`mt-1 ${field({ invalid: Boolean(error) })}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          autoFocus={autoFocus}
        />
      )}

      {error ? (
        <span id={`${id}-error`} role="alert" className="mt-1 block text-xs text-[var(--color-danger)]">
          {error}
        </span>
      ) : null}

      {/*
        A teacher has already proposed a change to this field and it is still in
        the queue. Saying so is not optional: approving it later will overwrite
        whatever is typed here, because the review path writes master
        unconditionally and stamps `teacher`, which outranks `office`.
      */}
      {pending ? (
        <span className="mt-1 block text-xs text-[var(--color-warning)]">
          {pending}{" "}
          <Link href="/review" className="underline">
            review it
          </Link>
          {" — approving it will replace whatever you type here."}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">{hint}</span>
      ) : null}
    </label>
  );
}
