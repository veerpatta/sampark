"use server";

import { revalidatePath } from "next/cache";
import { canCreateRequests, requireUser } from "@/lib/auth/session";
import { markGroupSent, resumeBatch } from "@/lib/batches";
import { sendRoundGroup, type SendOutcome } from "@/lib/whatsapp-send";

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

/**
 * Send one card of the queue through the WhatsApp API.
 *
 * Takes the card's key and rebuilds the message on the server — see
 * lib/whatsapp-send.ts for why nothing about the text comes from the browser.
 * The tick happens inside the core on success, so this action only has to
 * revalidate; the manual setGroupSent above is untouched and is what the
 * wa.me fallback still uses.
 */
export async function sendGroupViaApi(
  batchId: string,
  groupKey: string,
  force = false,
): Promise<SendOutcome> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return { ok: false, error: "Your role cannot send requests." };
  }

  const outcome = await sendRoundGroup({ batchId, groupKey, actor: user.id, force });
  revalidatePath(`/requests/batch/${batchId}`);
  revalidatePath("/requests");
  revalidatePath("/");
  return outcome;
}
