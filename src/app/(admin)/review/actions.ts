"use server";

import { revalidatePath } from "next/cache";
import { canApproveIntoMaster, requireUser } from "@/lib/auth/session";
import { decideSubmissions, type Decision } from "@/lib/submissions";

/**
 * The one door into the master record.
 *
 * `office` can see the queue and can create requests, but cannot approve —
 * plan section 5, and the single most important line in the role table. The
 * check is here rather than only in the UI, because a hidden button is not a
 * permission.
 *
 * Takes explicit arguments rather than a FormData. The first version used a
 * form with `<button name="decision" value="approved">`, and the submitter's
 * name never arrived in the action — every approval failed with "Unknown
 * decision". Passing the ids and the decision directly is both harder to get
 * wrong and type-checked.
 */
export async function decide(
  ids: string[],
  decision: Decision,
  note?: string,
): Promise<{ applied: number; studentsTouched: number }> {
  const user = await requireUser();
  if (!canApproveIntoMaster(user.role)) {
    throw new Error(
      "Your role can review changes but cannot approve them into the master record.",
    );
  }

  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("Unknown decision.");
  }

  const clean = ids.filter((id) => typeof id === "string" && id.length > 0);
  if (clean.length === 0) return { applied: 0, studentsTouched: 0 };

  const result = await decideSubmissions(
    clean,
    decision,
    user.id,
    note?.trim() || undefined,
  );

  revalidatePath("/review");
  revalidatePath("/students");
  revalidatePath("/requests");
  revalidatePath("/");

  return { applied: result.applied, studentsTouched: result.studentsTouched };
}
