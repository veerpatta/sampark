"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { canApproveIntoMaster, ForbiddenError, requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import {
  applyEdits,
  editFields,
  isBulkColumn,
  registryOptions,
  writeOfficeEdits,
  type BulkColumn,
  type FieldChange,
} from "@/lib/student-edit";
import type { BulkResult } from "@/components/admin/BulkBar";

/**
 * The most rows one tap may change — the board's largest page.
 *
 * Not exported: a "use server" module may only export async functions, and
 * the bar has no need of the number — the action says it in its refusal.
 */
const BULK_MAX = 250;

/**
 * Set one group fact on many children — the house for a whole section, the
 * bus route for a whole village, "left" for a family that moved.
 *
 * N ORDINARY EDITS, NOT ONE UPDATE. Each child goes through the same
 * editFields + applyEdits the single form uses, so validation is per child, a
 * change_log row is written per child, and an office stamp lands on each. A
 * child the rule refuses is skipped and named; the rest still land. See
 * writeOfficeEdits for how the batches are cut.
 */
export async function bulkEditStudents(
  ids: string[],
  patch: { column: BulkColumn; value: string },
): Promise<BulkResult> {
  const user = await requireUser();
  if (!canApproveIntoMaster(user.role)) {
    throw new ForbiddenError("Your role can view students but not edit them.");
  }
  if (!isBulkColumn(patch.column)) {
    throw new Error("That field cannot be set in bulk.");
  }

  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  if (unique.length > BULK_MAX) {
    throw new Error(`Select ${BULK_MAX} students or fewer at a time.`);
  }

  const [options, students] = await Promise.all([
    registryOptions(),
    db.select().from(schema.students).where(inArray(schema.students.id, unique)),
  ]);

  const edits: { studentId: string; changes: FieldChange[] }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  let unchanged = 0;

  for (const student of students) {
    const fields = editFields(student, options).filter((field) => field.column === patch.column);
    const { changes, errors } = applyEdits(student, fields, (column) =>
      column === patch.column ? patch.value : null,
    );
    const reason = errors[patch.column] ?? errors._;
    if (reason) {
      skipped.push({ id: student.id, reason });
      continue;
    }
    if (changes.length === 0) {
      unchanged += 1;
      continue;
    }
    edits.push({ studentId: student.id, changes });
  }

  await writeOfficeEdits(edits, user.id);

  revalidatePath("/students");
  revalidatePath("/settings/audit");
  revalidatePath("/");
  for (const edit of edits) revalidatePath(`/students/${edit.studentId}`);

  return {
    updated: edits.length,
    unchanged,
    skipped: skipped.length > 0 ? skipped : undefined,
  };
}
