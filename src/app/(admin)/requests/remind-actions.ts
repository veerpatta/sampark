"use server";

import { revalidatePath } from "next/cache";
import { canCreateRequests, requireUser } from "@/lib/auth/session";
import { markGroupReminded } from "@/lib/batches";

/**
 * Record a chase made from the dashboard or the requests board.
 *
 * THE ROUND PAGE IS NOT THE ONLY PLACE A TEACHER GETS NUDGED. The same Remind
 * button sits on the dashboard's top-five list and on /requests?view=teachers,
 * and if those two recorded nothing then remind_count would be a lie — it would
 * say "chased once" about a teacher the office had messaged four times from
 * whichever screen happened to be open. A column that is only sometimes written
 * is worse than no column, because a reader cannot tell which case they have.
 *
 * Deliberately separate from the round page's own action, which revalidates one
 * round's path. This one revalidates the two screens it is reachable from.
 * Same guard, same lib call, no shared cleverness — two four-line actions beside
 * each other beat one that takes a path to revalidate.
 */
export async function remindFromBoard(requestIds: string[]): Promise<void> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    throw new Error("Your role cannot send requests.");
  }

  await markGroupReminded(requestIds, user.id);
  revalidatePath("/");
  revalidatePath("/requests");
}
