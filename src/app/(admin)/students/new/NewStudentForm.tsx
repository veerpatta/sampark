"use client";

import { useActionState } from "react";
import Link from "next/link";
import { btn, field } from "@/components/ui/controls";
import { EditInput } from "@/components/admin/EditInput";
import { Card } from "@/components/admin/Card";
import type { EditField, EditSection } from "@/lib/student-edit";
import { addStudent, type CreateResult } from "./actions";

/**
 * The new-student form: the edit form's sections over an empty record.
 *
 * TYPE-ONLY IMPORTS FROM lib/student-edit — same rule as StudentEditForm. The
 * page builds the fields and the sections; this draws them.
 */
export function NewStudentForm({
  sections,
  fields,
}: {
  sections: EditSection[];
  fields: EditField[];
}) {
  const [result, formAction, saving] = useActionState<CreateResult | null, FormData>(
    addStudent,
    null,
  );
  const errors = result?.errors ?? {};
  const byColumn = new Map(fields.map((spec) => [spec.column, spec]));

  return (
    <form action={formAction} className="space-y-5 md:space-y-6">
      <Card title="Student ID">
        <label className="block" htmlFor="new-id">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            PSP student ID, if known
          </span>
          <input
            id="new-id"
            name="id"
            autoComplete="off"
            placeholder="Leave blank for a temporary ID"
            className={`mt-1 ${field({ invalid: Boolean(errors.id) })}`}
            aria-invalid={errors.id ? true : undefined}
          />
          {errors.id ? (
            <span role="alert" className="mt-1 block text-xs text-[var(--color-danger)]">
              {errors.id}
            </span>
          ) : (
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              Blank gets a <span className="font-mono">TMP-</span> id that shows on the board until the
              real one arrives. Never match a child by name.
            </span>
          )}
        </label>
      </Card>

      {sections.map((section) => (
        <Card key={section.key} title={section.title}>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.columns.map((column) => {
              const spec = byColumn.get(column);
              if (!spec) return null;
              return (
                <EditInput
                  key={column}
                  idPrefix="new"
                  spec={spec}
                  error={errors[column]}
                  required={column === "name" || column === "classLabel"}
                  autoFocus={column === "name"}
                />
              );
            })}
          </div>
        </Card>
      ))}

      <Card title="Note">
        <input
          name="note"
          maxLength={200}
          placeholder="Optional — e.g. admitted 3 Sep, TC from Govt. school Amet"
          className={field()}
        />
      </Card>

      {errors._ ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {errors._}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={btn({ shape: "commit", tone: "primary" })}>
          {saving ? "Adding…" : "Add student"}
        </button>
        <Link href="/students" className={btn()}>
          Cancel
        </Link>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Every field is recorded with your name and stamped as set by the office,
          so the next import cannot overwrite it.
        </p>
      </div>
    </form>
  );
}
