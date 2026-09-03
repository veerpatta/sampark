"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canApproveIntoMaster, ForbiddenError, requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import {
  createStudent,
  newStudentFields,
  planNewStudent,
  registryOptions,
} from "@/lib/student-edit";
import { temporaryStudentId } from "@/lib/students-import";

/**
 * The office adding a child by hand — a mid-year admission, a sibling PSP has
 * not caught up with. The fourth door into the master record, and it opens onto
 * the same rules as the third: canApproveIntoMaster, a change_log row for
 * every field, an office stamp on every value. See lib/student-edit.ts.
 */

export type CreateResult = { ok: false; errors: Record<string, string> };

/** The `(previous, formData)` shape useActionState wants; see login/actions.ts. */
export async function addStudent(
  _previous: CreateResult | null,
  formData: FormData,
): Promise<CreateResult> {
  const user = await requireUser();
  if (!canApproveIntoMaster(user.role)) {
    throw new ForbiddenError("Your role can view students but not add one.");
  }

  // Rebuilt on the server, never taken from the request — the form could name
  // any column it liked and reach none of them.
  const fields = newStudentFields(await registryOptions());
  const plan = planNewStudent(fields, (column) => {
    const value = formData.get(column);
    return typeof value === "string" ? value : null;
  });
  if (Object.keys(plan.errors).length > 0) return { ok: false, errors: plan.errors };

  const id = plan.id ?? temporaryStudentId();

  const [existing] = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(eq(schema.students.id, id))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      errors: { id: `${id} already exists — open that record instead of adding another.` },
    };
  }

  const note = String(formData.get("note") ?? "").trim().slice(0, 200) || null;
  await createStudent({ id, changes: plan.changes, decidedBy: user.id, note });

  revalidatePath("/students");
  revalidatePath("/settings/audit");
  revalidatePath("/");

  // Throws NEXT_REDIRECT; deliberately outside any try/catch.
  redirect(`/students/${encodeURIComponent(id)}`);
}
