"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { btn, field } from "@/components/ui/controls";
import { useToast } from "@/components/ui/Toast";
import { saveStudent, type SaveResult } from "@/app/(admin)/students/[id]/actions";
import type { EditField } from "@/lib/student-edit";

/**
 * The form behind "What we hold".
 *
 * TYPE-ONLY IMPORTS FROM lib/student-edit, and it has to stay that way. That
 * module reaches IMPORT_COLUMNS, which imports `node:crypto`; a value imported
 * from it here would pull a polyfill of that into the console bundle. The page
 * is a server component and builds the EditField[] — this only draws it.
 */
export function StudentEditForm({
  studentId,
  fields,
  pending,
}: {
  studentId: string;
  fields: EditField[];
  /** Columns a teacher has a correction waiting on, by students column name. */
  pending: Map<string, string>;
}) {
  // Passed straight in: the action's signature IS the useActionState contract,
  // (previous, formData) => result. See login/actions.ts for the same shape and
  // for why validation comes back as a value rather than as a thrown Error.
  const [result, formAction, saving] = useActionState<SaveResult | null, FormData>(
    saveStudent,
    null,
  );

  const router = useRouter();
  const toast = useToast();
  const announced = useRef<SaveResult | null>(null);

  useEffect(() => {
    if (!result || result === announced.current) return;
    announced.current = result;

    if (!result.ok) return; // the messages are already beside their boxes

    if (result.changed === 0) {
      toast({ message: "Nothing had changed, so nothing was saved.", tone: "info" });
      return;
    }

    // NO UNDO. Toast.tsx's rule is that undo is offered only where the action is
    // genuinely reversible, and this one is not: the change_log row is in an
    // append-only table and cannot be withdrawn. Correcting it back is another
    // edit, and the history should say so.
    toast({
      message:
        result.changed === 1
          ? "Saved. One field changed."
          : `Saved. ${result.changed} fields changed.`,
      tone: "success",
    });
    router.refresh();
  }, [result, router, toast]);

  const errors = result && !result.ok ? result.errors : {};

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="studentId" value={studentId} />

      {errors._ ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {errors._}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((spec) => (
          <Input
            key={spec.column}
            spec={spec}
            error={errors[spec.column]}
            pending={pending.get(spec.column)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-4">
        <button type="submit" disabled={saving} className={btn({ shape: "commit", tone: "primary" })}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Every change is recorded below with your name, and marked as set by the
          office so no import can undo it.
        </p>
      </div>
    </form>
  );
}

function Input({
  spec,
  error,
  pending,
}: {
  spec: EditField;
  error?: string;
  pending?: string;
}) {
  const id = `edit-${spec.column}`;

  return (
    <label className="block" htmlFor={id}>
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">
        {spec.label}
      </span>

      {spec.control === "select" ? (
        <select
          id={id}
          name={spec.column}
          defaultValue={spec.value}
          className={`mt-1 ${field({ invalid: Boolean(error) })}`}
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
          name={spec.column}
          type={spec.control === "date" ? "date" : "text"}
          // `tel` and `number` as inputMode rather than as type: type="number"
          // brings spinners and silently drops a leading zero, and type="tel"
          // gives no validation this form is not already doing on the server.
          inputMode={
            spec.control === "tel" || spec.control === "number" ? "numeric" : undefined
          }
          defaultValue={spec.value}
          className={`mt-1 ${field({ invalid: Boolean(error) })}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      )}

      {error ? (
        <span
          id={`${id}-error`}
          role="alert"
          className="mt-1 block text-xs text-[var(--color-danger)]"
        >
          {error}
        </span>
      ) : null}

      {/*
        A teacher has already proposed a change to this field and it is still in
        the queue. Saying so is not optional: approving it later will overwrite
        whatever is typed here, because the review path writes master
        unconditionally and stamps `teacher`, which outranks `office`. The
        sentence has to say that, not merely that something is waiting.
      */}
      {pending ? (
        <span className="mt-1 block text-xs text-[var(--color-warning)]">
          {pending}{" "}
          <Link href="/review" className="underline">
            review it
          </Link>
          {" — approving it will replace whatever you type here."}
        </span>
      ) : null}
    </label>
  );
}
