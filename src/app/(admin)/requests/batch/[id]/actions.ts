"use server";

import { revalidatePath } from "next/cache";
import { canCreateRequests, requireUser } from "@/lib/auth/session";
import { markGroupReminded, markGroupSent, resumeBatch } from "@/lib/batches";

/**
 * Record that one teacher's message was handed over — or take the tick back.
 *
 * Takes every request id on her card, because the message carried all of them
 * and they are equally sent. One statement, not one per link.
 */
export async function setGroupSent(
  requestIds: string[],
  batchId: string,
  sent: boolean,
): Promise<void> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    throw new Error("Your role cannot send requests.");
  }

  await markGroupSent(requestIds, user.id, sent);
  revalidatePath(`/requests/batch/${batchId}`);
}

/**
 * Record that one teacher was chased about everything she owes in this round.
 *
 * Takes every request id on her card, for the reason setGroupSent above does:
 * the nudge carried all of them, so all of them are equally chased.
 *
 * NO BOOLEAN, unlike setGroupSent. A send tick has to be takeable back for
 * "WhatsApp opened" to be an honest claim; a reminder that has gone cannot be
 * un-sent. What the queue reads instead is WHEN — it asks whether reminded_at
 * falls on today's school date — so a new day empties the queue with nobody
 * having to remember to reset anything. See markGroupReminded.
 */
export async function recordReminded(
  requestIds: string[],
  batchId: string,
): Promise<void> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    throw new Error("Your role cannot send requests.");
  }

  await markGroupReminded(requestIds, user.id);
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
