"use client";

import { useState } from "react";
import { BulkBar, type BulkAction } from "@/components/admin/BulkBar";
import { field } from "@/components/ui/controls";
import type { EditField } from "@/lib/student-edit";
import { bulkEditStudents } from "./actions";

/**
 * Tick some children, set one thing on all of them.
 *
 * The field and value controls live INSIDE the bar, beside Apply, so choosing
 * and doing are one gesture under the thumb. The value control is drawn from
 * the same EditField the single form uses — the server built it from the same
 * option lists — so the bar cannot offer a house the action then refuses.
 *
 * A browser confirm, because forty change_log rows cannot be withdrawn, and
 * the sentence names the number.
 */
export function StudentBulkBar({
  fields,
  children,
}: {
  fields: EditField[];
  children: React.ReactNode;
}) {
  const [column, setColumn] = useState<string>(fields[0]?.column ?? "");
  const [value, setValue] = useState("");
  const spec = fields.find((entry) => entry.column === column);

  const actions: BulkAction[] = [
    {
      label: "Apply to selected",
      confirm: (n) =>
        value.trim() === ""
          ? `Clear ${spec?.label ?? column} on ${n} ${n === 1 ? "student" : "students"}?\n\nEach change is recorded with your name and cannot be withdrawn.`
          : `Set ${spec?.label ?? column} to "${value}" on ${n} ${n === 1 ? "student" : "students"}?\n\nEach change is recorded with your name and cannot be withdrawn.`,
      run: (ids) =>
        bulkEditStudents(ids, { column: column as Parameters<typeof bulkEditStudents>[1]["column"], value }),
    },
  ];

  /*
   * TWO CONTROLS ON ONE ROW, NOT TWO ROWS. `field()` carries `w-full`, so each
   * select took the whole width and the bar stood 241px tall on a 390px phone
   * — a third of the screen, over the rows it was acting on. `flex-1` wins
   * that argument in flex layout whatever order the classes land in, which
   * `w-auto` does not.
   */
  const controls = (
    <span className="flex w-full items-center gap-2 md:w-auto">
      <label className="sr-only" htmlFor="bulk-column">
        Field to set
      </label>
      <select
        id="bulk-column"
        value={column}
        onChange={(event) => {
          setColumn(event.target.value);
          setValue("");
        }}
        className={`${field()} min-w-0 flex-1 md:min-h-0 md:flex-none md:py-2`}
      >
        {fields.map((entry) => (
          <option key={entry.column} value={entry.column}>
            {entry.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="bulk-value">
        Value
      </label>
      {spec?.control === "select" ? (
        <select
          id="bulk-value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${field()} min-w-0 flex-1 md:min-h-0 md:flex-none md:py-2`}
        >
          <option value="">— clear —</option>
          {spec.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id="bulk-value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={spec?.label ?? "Value"}
          className={`${field()} min-w-0 flex-1 md:min-h-0 md:w-32 md:flex-none md:py-2`}
        />
      )}
    </span>
  );

  return (
    <BulkBar name="student" actions={actions} controls={controls}>
      {children}
    </BulkBar>
  );
}
