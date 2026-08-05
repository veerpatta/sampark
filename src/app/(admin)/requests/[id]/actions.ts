"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canCreateRequests, requireUser } from "@/lib/auth/session";

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
