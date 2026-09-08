"use server";

import { revalidatePath } from "next/cache";
import { canCreateRequests, requireUser } from "@/lib/auth/session";
import { markGroupReminded } from "@/lib/batches";
import { todayISO } from "@/lib/today";
import {
  reminderVerdict,
  sendTeacherReminder,
  type SendOutcome,
} from "@/lib/whatsapp-send";

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

/** What a whole pass of the chase list did. */
export type BulkReminderOutcome = {
  /** Messages the provider accepted. */
  sent: number;
  /** Teachers already reminded today, left alone rather than sent twice. */
  skipped: number;
  /** Refusals, in the order they happened, with the provider's own sentence. */
  failed: { teacher: string; error: string }[];
  /** True when the run gave up early — see the consecutive-failure guard. */
  stopped: boolean;
};

/**
 * A cap, so a mis-click cannot bill for a hundred messages.
 *
 * The whole staff is about thirty and a round is about sixteen, so this is far
 * above any real list; it exists for the case where a bug hands this action a
 * list it should never have had. Same reasoning as MAX_GROUPS in lib/batches.ts.
 */
const MAX_BULK_REMINDERS = 60;

/**
 * Enough refusals in a row to stop rather than keep hammering the provider.
 *
 * One refusal is a bad number; three in a row is the account, the template or
 * the key — and in that state the next fifty attempts will fail too, each one a
 * request against a rate limit the office cannot see. Stopping and saying so is
 * more use than a wall of identical errors.
 */
const GIVE_UP_AFTER = 3;

/**
 * Chase EVERY teacher who still owes something, in one tap.
 *
 * SEQUENTIAL, NOT Promise.all, and for the reasons runGroups in lib/batches.ts
 * gives: concurrent bursts are how you meet a provider's rate limit, and going
 * in order means a failure stops at a known point rather than somewhere in the
 * middle of sixteen half-finished sends.
 *
 * NEVER FORCED. sendTeacherReminder refuses a teacher already reminded today,
 * and that refusal is the feature here rather than an obstacle: it makes a
 * second tap of this button a no-op instead of a second message to everyone who
 * already got one. Those refusals are counted as `skipped`, not as failures —
 * nothing went wrong, and reporting them as errors would teach the office to
 * ignore the error line.
 *
 * ONE REVALIDATION AT THE END, not one per teacher: sixteen sends should not
 * re-render three screens sixteen times.
 *
 * It exists only for the API path. There is no bulk equivalent for wa.me, and
 * there cannot be — a click-to-chat link opens one conversation and needs a real
 * tap to do it, so N teachers is N taps however it is dressed up. What the
 * screen offers instead is a queue that removes the DECISIONS rather than the
 * taps. See RemindAll.
 */
export async function remindEveryoneViaApi(
  teacherKeys: string[],
  batchId?: string,
): Promise<BulkReminderOutcome> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    return {
      sent: 0,
      skipped: 0,
      failed: [{ teacher: "", error: "Your role cannot send requests." }],
      stopped: true,
    };
  }

  const keys = teacherKeys.slice(0, MAX_BULK_REMINDERS);
  const out: BulkReminderOutcome = {
    sent: 0,
    skipped: 0,
    failed: [],
    stopped: false,
  };
  let consecutive = 0;

  for (const key of keys) {
    const outcome = await sendTeacherReminder({
      teacherKey: key,
      batchId: batchId ?? null,
      actor: user.id,
      force: false,
    });

    const verdict = reminderVerdict(outcome);
    if (verdict === "sent") {
      out.sent += 1;
      consecutive = 0;
      continue;
    }
    // Not a failure: she has already been chased today, or has nothing left
    // outstanding because an answer arrived while this loop was running.
    if (verdict === "skipped") {
      out.skipped += 1;
      consecutive = 0;
      continue;
    }

    // The card's name is not to hand here — the key is `teacherId|phone`, and
    // the screen that called this already knows which teacher that is.
    out.failed.push({
      teacher: key,
      error: outcome.ok ? "" : outcome.error,
    });
    consecutive += 1;
    if (consecutive >= GIVE_UP_AFTER) {
      out.stopped = true;
      break;
    }
  }

  revalidatePath("/");
  revalidatePath("/requests");
  if (batchId) revalidatePath(`/requests/batch/${batchId}`);
  return out;
}
