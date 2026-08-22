"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { canApproveIntoMaster, requireUser, ForbiddenError } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import {
  applyEdits,
  editFields,
  registryOptions,
  writeOfficeEdit,
} from "@/lib/student-edit";

/**
 * The office correcting one child's record.
 *
 * This is the third door into the master record, after the review queue and the
 * import wizard, and it is the first one a human can walk through with a
 * keyboard. What makes that safe is written at the top of lib/student-edit.ts;
 * what makes it possible is that the person here is the same person who would
 * otherwise have approved the identical change in /review.
 */

export type SaveResult =
  | { ok: true; changed: number }
  | { ok: false; errors: Record<string, string> };

/**
 * Note the `(previous, formData)` shape: this is the useActionState contract,
 * following login/actions.ts.
 *
 * THE OTHER PRECEDENT WOULD HAVE BEEN WRONG HERE. settings/teachers/actions.ts
 * answers bad input by throwing, which in a plain <form action> hits the error
 * boundary and takes the page down. On a three-field form that is a shrug; on
 * this one the office loses twenty other boxes she had just filled in, to tell
 * her about one. So validation comes back as data, keyed by column so each
 * message can be rendered against the input it is about.
 *
 * A ROLE FAILURE STILL THROWS. That is not a correctable typo and there is no
 * box to render it beside — the form should never have been on screen.
 */
export async function saveStudent(
  _previous: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const user = await requireUser();
  // Here and not only in the page. A button that is not rendered is not a
  // permission — the same reason review/actions.ts re-checks.
  if (!canApproveIntoMaster(user.role)) {
    throw new ForbiddenError("Your role can view a student but not edit one.");
  }

  const studentId = String(formData.get("studentId") ?? "");
  const [student] = await db
    .select()
    .from(schema.students)
    .where(eq(schema.students.id, studentId))
    .limit(1);

  if (!student) {
    return { ok: false, errors: { _: "That student no longer exists." } };
  }

  // Rebuilt on the server, never taken from the request. The form could name
  // any column it liked and reach none of them — the same discipline the
  // importer applies by rebuilding its plan at apply time.
  const fields = editFields(student, await registryOptions());

  const { changes, errors } = applyEdits(student, fields, (column) => {
    const value = formData.get(column);
    return typeof value === "string" ? value : null;
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // Nothing to do. No change_log rows for a save that changed nothing, and no
  // updated_at bump either — that column is read as "when did this record last
  // actually move".
  if (changes.length === 0) return { ok: true, changed: 0 };

  await writeOfficeEdit({ studentId, changes, decidedBy: user.id });

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  revalidatePath("/settings/audit");

  return { ok: true, changed: changes.length };
}
