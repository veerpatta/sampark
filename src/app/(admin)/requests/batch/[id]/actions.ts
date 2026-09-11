"use server";

import { revalidatePath } from "next/cache";
import {
  canCreateRequests,
  canManageSettings,
  requireUser,
} from "@/lib/auth/session";
import {
  ensureMasterLink,
  findMasterLink,
  markGroupSent,
  resumeBatch,
} from "@/lib/batches";
import { rotateRequestToken } from "@/lib/requests";
import {
  sendMasterLink,
  sendRoundGroup,
  type SendOutcome,
} from "@/lib/whatsapp-send";

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

/* ============ THE ROUND'S OWN LINK ============ */

/**
 * Send the master link — to the office, or to a number typed on the screen.
 *
 * `canCreateRequests`, the same gate as every other send on this page. Handing
 * over a link that already exists asks a question; it changes no master data,
 * and every answer still goes through the review queue. Who it went to and who
 * sent it is a whatsapp_messages row, written inside sendMasterLink.
 */
export async function sendMasterLinkViaApi(
  batchId: string,
  phone?: string | null,
): Promise<SendOutcome> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return { ok: false, error: "Your role cannot send requests." };
  }

  const outcome = await sendMasterLink({ batchId, phone, actor: user.id });
  revalidatePath(`/requests/batch/${batchId}`);
  return outcome;
}

/**
 * Mint the master link for a round that has none.
 *
 * A round created before anybody set the office number has no master link, and
 * nothing about it is broken — this is the button that adds one afterwards.
 * Idempotent: ensureMasterLink returns the existing row if there is one.
 */
export async function mintMasterLink(
  batchId: string,
): Promise<{ token: string | null; error: string | null }> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return { token: null, error: "Your role cannot create requests." };
  }

  try {
    const master = await ensureMasterLink({ batchId, createdBy: user.id });
    revalidatePath(`/requests/batch/${batchId}`);
    if (!master) {
      return {
        token: null,
        error:
          "Could not make one. Set the office number in Settings → Office — and note that a subject round never gets a master link.",
      };
    }
    return { token: master.token, error: null };
  } catch (error) {
    return {
      token: null,
      error: error instanceof Error ? error.message : "Could not make one.",
    };
  }
}

/**
 * Replace the master link's address. The old one dies in the same statement.
 *
 * OWNER ONLY — canManageSettings, not canCreateRequests. This is the kill
 * switch for a link that reaches every class in the round, and it is the same
 * gate that issues and revokes a teacher's durable link. Whoever rotates it
 * strands the previous holder, which is the point.
 */
export async function rotateMasterLink(
  batchId: string,
): Promise<{ token: string | null; error: string | null }> {
  const user = await requireUser();
  if (!canManageSettings(user.role)) {
    return { token: null, error: "Only an owner can rotate a master link." };
  }

  const master = await findMasterLink(batchId);
  if (!master) return { token: null, error: "This round has no master link." };

  const token = await rotateRequestToken(master.requestId);
  revalidatePath(`/requests/batch/${batchId}`);
  revalidatePath("/settings/office");
  return { token, error: null };
}
