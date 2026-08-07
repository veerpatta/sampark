"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  canApproveIntoMaster,
  canCreateRequests,
  requireUser,
} from "@/lib/auth/session";

/**
 * Close and reopen a request.
 *
 * Closing is how the office says "we have what we need" — the link stops
 * opening immediately, before the due date and its grace period run out.
 * resolveToken treats a closed request exactly like one that never existed, so
 * a forwarded link goes dead the moment this is clicked. That makes it the main
 * mitigation left now the PIN is gone.
 *
 * Reopening exists because a teacher will always turn up the day after with one
 * more correction, and making the office mint a fresh link and re-send it on
 * WhatsApp would be a poor trade for a single phone number.
 */
export async function setRequestStatus(id: string, status: "open" | "closed") {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    throw new Error("Not permitted.");
  }
  if (status !== "open" && status !== "closed") {
    throw new Error("Unknown status.");
  }

  await db
    .update(schema.requests)
    .set(
      status === "closed"
        ? { status: "closed", closedAt: new Date() }
        : // Clearing closedAt keeps "was it ever closed?" honest — a reopened
          // request is open, not closed-with-an-exception.
          { status: "open", closedAt: null },
    )
    .where(eq(schema.requests.id, id));

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
}

export type RemoveOutcome = { outcome: "deleted" | "archived"; answers: number };

/**
 * Take a finished request off the boards.
 *
 * ONE BUTTON, TWO OUTCOMES, AND THE DATABASE DECIDES WHICH. A request that
 * collected nothing — sent to the wrong class, superseded an hour later — is
 * genuinely deleted, and its frozen roster goes with it on the cascade. There is
 * no history in it to lose.
 *
 * A request that collected answers is archived instead. That is not squeamishness
 * about deleting: `submissions.request_id` references this row with no cascade,
 * and app_rw has DELETE revoked on that table by grant (Rule 4, append-only,
 * drizzle/sql/grants.sql). A DELETE would fail on the foreign key, and it SHOULD
 * — a teacher's answer and the office's decision on it are the two things this
 * system exists to keep. So the row stays, marked, and stops appearing.
 *
 * Closed only. Deleting a live link would strand a teacher mid-answer holding a
 * URL that has started 404ing, with no way for anyone to tell her why.
 *
 * Owner and admin only, matching canApproveIntoMaster rather than
 * canCreateRequests: `office` can create a request and close it, and neither of
 * those destroys anything.
 */
export async function removeRequest(id: string): Promise<RemoveOutcome> {
  const user = await requireUser();
  if (!canApproveIntoMaster(user.role)) {
    throw new Error("Not permitted.");
  }

  const [request] = await db
    .select({ status: schema.requests.status })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1);

  if (!request) throw new Error("That request no longer exists.");
  if (request.status !== "closed") {
    throw new Error("Close the request first — a live link must not vanish.");
  }

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.submissions)
    .where(eq(schema.submissions.requestId, id));
  const answers = counted?.n ?? 0;

  if (answers === 0) {
    // request_students cascades (drizzle/schema.ts). Nothing else points here:
    // student_records.request_id is written only when a change is APPROVED, and
    // no submission means no approval.
    await db.delete(schema.requests).where(eq(schema.requests.id, id));
  } else {
    await db
      .update(schema.requests)
      .set({ archivedAt: new Date() })
      .where(eq(schema.requests.id, id));
  }

  revalidatePath("/requests");
  revalidatePath("/");
  if (answers > 0) revalidatePath(`/requests/${id}`);

  return { outcome: answers === 0 ? "deleted" : "archived", answers };
}

/** Put an archived request back on the boards. Deleting has no such door. */
export async function restoreRequest(id: string) {
  const user = await requireUser();
  if (!canApproveIntoMaster(user.role)) {
    throw new Error("Not permitted.");
  }

  await db
    .update(schema.requests)
    .set({ archivedAt: null })
    .where(eq(schema.requests.id, id));

  revalidatePath("/requests");
  revalidatePath("/");
  revalidatePath(`/requests/${id}`);
}
