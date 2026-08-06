"use server";

import { revalidatePath } from "next/cache";
import { canCreateRequests, requireUser } from "@/lib/auth/session";
import { markSent, resumeBatch } from "@/lib/batches";

/** Record that a link was handed over — or take the tick back. */
export async function setSent(
  requestId: string,
  batchId: string,
  sent: boolean,
): Promise<void> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    throw new Error("Your role cannot send requests.");
  }

  await markSent(requestId, user.id, sent);
  revalidatePath(`/requests/batch/${batchId}`);
}

/** Finish a fan-out that stopped part way. */
export async function resume(
  batchId: string,
): Promise<{ created: number; error: string | null }> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    throw new Error("Your role cannot create requests.");
  }

  try {
    const result = await resumeBatch(batchId, user.id);
    revalidatePath(`/requests/batch/${batchId}`);
    revalidatePath("/requests");
    return {
      created: result.created.length,
      error: result.failed?.message ?? null,
    };
  } catch (error) {
    return {
      created: 0,
      error: error instanceof Error ? error.message : "Could not resume.",
    };
  }
}
