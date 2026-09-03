"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { btn, field } from "@/components/ui/controls";
import { useToast } from "@/components/ui/Toast";
import { saveStudent, type SaveResult } from "@/app/(admin)/students/[id]/actions";
import { EditInput } from "./EditInput";
import type { EditField } from "@/lib/student-edit";

/**
 * One section of a student's record, editable.
 *
 * The page mounts one of these per section (identity, family, school…), each
 * with only its own fields. That works because the action's rule is that a
 * field ABSENT from the form is left alone — see applyEdits — so five small
 * forms and one big one write exactly the same rows.
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
  provenance,
  note = true,
}: {
  studentId: string;
  fields: EditField[];
  /** Columns a teacher has a correction waiting on, by students column name. */
  pending: Map<string, string>;
  /** One line per column saying where its current value came from. */
  provenance?: Map<string, string>;
  /** Offer a note box. Off for the one-field status section, where it is the whole point — see the page. */
  note?: boolean;
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
  const form = useRef<HTMLFormElement>(null);

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
    // Close the disclosure the form sits in, so the card reads as a record again.
    form.current?.closest("details")?.removeAttribute("open");
    router.refresh();
  }, [result, router, toast]);

  const errors = result && !result.ok ? result.errors : {};

  return (
    <form ref={form} action={formAction} className="space-y-4">
      <input type="hidden" name="studentId" value={studentId} />

      {errors._ ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {errors._}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((spec) => (
          <EditInput
            key={spec.column}
            spec={spec}
            error={errors[spec.column]}
            pending={pending.get(spec.column)}
            hint={provenance?.get(spec.column) ?? null}
          />
        ))}
      </div>

      {note ? (
        <label className="block">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            Note (optional)
          </span>
          <input
            name="note"
            maxLength={200}
            placeholder="Why — e.g. parent rang, number changed"
            className={`mt-1 ${field()}`}
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-4">
        <button type="submit" disabled={saving} className={btn({ shape: "commit", tone: "primary" })}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Every change is recorded with your name, and marked as set by the
          office so no import can undo it.
        </p>
      </div>
    </form>
  );
}
