"use server";

import { revalidatePath } from "next/cache";
import { canCreateRequests, requireUser } from "@/lib/auth/session";
import { markGroupReminded } from "@/lib/batches";
import { todayISO } from "@/lib/today";
import { sendTeacherReminder, type SendOutcome } from "@/lib/whatsapp-send";

/**
 * Record that the office chased one teacher — or take the tick back.
 *
 * SHARED, AND AT THIS LEVEL RATHER THAN UNDER batch/[id], because the chase
 * happens from three screens: the dashboard's top-five, the whole board at
 * /requests, and one round's own queue. Putting it beside the round's other
 * actions would have made the other two import across sibling routes, and the
 * revalidation below is the reason it should be one function anyway — a tick on
 * the dashboard has to leave the round page correct too.
 *
 * TAKES EVERY REQUEST ID ON HER CARD, because the message carried all of them and
 * they were equally chased. Same shape and same reason as setGroupSent.
 */
export async function setTeacherReminded(
  requestIds: string[],
  reminded: boolean,
  /** The round to revalidate as well, when the chase started on one. */
  batchId?: string,
): Promise<void> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    throw new Error("Your role cannot send requests.");
  }

  // todayISO is read HERE rather than taken as an argument: the guard inside
  // markGroupReminded exists to stop a stale tab undoing an old chase, and a
  // client-supplied date would be exactly the stale value it is guarding against.
  await markGroupReminded(requestIds, user.id, reminded, todayISO());

  revalidatePath("/");
  revalidatePath("/requests");
  if (batchId) revalidatePath(`/requests/batch/${batchId}`);
}

/**
 * Chase one teacher through the WhatsApp API.
 *
 * `teacherKey` is the card's `teacherId|phone`; with a batch id the nudge
 * covers that round, without one it covers everything she owes — the same
 * two shapes the two Remind buttons already describe. The core records the
 * chase itself on success (markGroupReminded, today's date read there), so
 * this action only checks the role and revalidates the three screens.
 */
export async function remindTeacherViaApi(
  teacherKey: string,
  batchId?: string,
  force = false,
): Promise<SendOutcome> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return { ok: false, error: "Your role cannot send requests." };
  }

  const outcome = await sendTeacherReminder({
    teacherKey,
    batchId: batchId ?? null,
    actor: user.id,
    force,
  });
  revalidatePath("/");
  revalidatePath("/requests");
  if (batchId) revalidatePath(`/requests/batch/${batchId}`);
  return outcome;
}
