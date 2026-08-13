"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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

  const result = await removeOne(id);

  revalidatePath("/requests");
  revalidatePath("/");
  if (result.answers > 0) revalidatePath(`/requests/${id}`);

  return result;
}

/**
 * The rule itself, with no permission check and no revalidation.
 *
 * Extracted so the single-request button and the bulk bar cannot drift apart.
 * A second copy of "closed only; nothing collected means delete, anything
 * collected means archive" is a second place for the archive half to be
 * forgotten — and forgetting it does not fail loudly, it throws a foreign-key
 * error on a row the office has already been told is gone.
 *
 * PRIVATE. Every caller must have checked canApproveIntoMaster first.
 */
async function removeOne(id: string): Promise<RemoveOutcome> {
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
    // a student_records row is only ever written alongside the submission that
    // produced it — in the same batch at submit time for a mark, in the same
    // transaction at approval for the backlog — so no submission means no
    // record. The count above is the whole guard.
    await db.delete(schema.requests).where(eq(schema.requests.id, id));
  } else {
    await db
      .update(schema.requests)
      .set({ archivedAt: new Date() })
      .where(eq(schema.requests.id, id));
  }

  return { outcome: answers === 0 ? "deleted" : "archived", answers };
}

/**
 * The same three verbs, over a selection.
 *
 * A nineteen-class fan-out leaves nineteen rows to clear one at a time, which
 * is how a board fills up with finished rounds nobody has the patience to tidy.
 *
 * IT REPORTS THE SPLIT RATHER THAN A TOTAL. "Archive selected" over five
 * requests genuinely does two different things — the ones that collected
 * nothing are deleted, the rest are archived — and a toast saying "5 archived"
 * would be false about however many were destroyed. `skipped` carries the ones
 * the rule refused, with the reason, so nothing fails silently either.
 *
 * PER ROW, NOT ONE TRANSACTION. These are independent requests, and one of them
 * being open should not roll back the four that were closed. The office would
 * have to find out which, uncheck it, and press the button again.
 */
export type BulkOutcome = {
  deleted: number;
  archived: number;
  closed: number;
  restored: number;
  /** One entry per request the rule refused, and why. */
  skipped: { id: string; reason: string }[];
};

const EMPTY: BulkOutcome = {
  deleted: 0,
  archived: 0,
  closed: 0,
  restored: 0,
  skipped: [],
};

export async function bulkRemoveRequests(ids: string[]): Promise<BulkOutcome> {
  const user = await requireUser();
  if (!canApproveIntoMaster(user.role)) {
    throw new Error("Not permitted.");
  }

  const outcome: BulkOutcome = { ...EMPTY, skipped: [] };
  for (const id of unique(ids)) {
    try {
      const result = await removeOne(id);
      if (result.outcome === "deleted") outcome.deleted += 1;
      else outcome.archived += 1;
    } catch (error) {
      outcome.skipped.push({ id, reason: reasonOf(error) });
    }
  }

  revalidatePath("/requests");
  revalidatePath("/");
  return outcome;
}

/**
 * Close a selection.
 *
 * Needed for the bulk remove to be usable at all: removeOne refuses anything
 * still open, so without this, selecting a round that has just finished and
 * pressing Archive skips every single row and explains why five times.
 *
 * `canCreateRequests`, not `canApproveIntoMaster` — closing destroys nothing
 * and reopening is one tap away, which is the same rule setRequestStatus uses.
 */
export async function bulkCloseRequests(ids: string[]): Promise<BulkOutcome> {
  const user = await requireUser();
  if (!canCreateRequests(user.role)) {
    throw new Error("Not permitted.");
  }

  const list = unique(ids);
  if (list.length === 0) return { ...EMPTY, skipped: [] };

  const closed = await db
    .update(schema.requests)
    .set({ status: "closed", closedAt: new Date() })
    // Only the ones that are actually open. Re-closing a closed request would
    // move its closedAt, which is the timestamp the grace period reads.
    .where(
      and(
        inArray(schema.requests.id, list),
        eq(schema.requests.status, "open"),
      ),
    )
    .returning({ id: schema.requests.id });

  revalidatePath("/requests");
  revalidatePath("/");
  for (const id of list) revalidatePath(`/requests/${id}`);

  return {
    ...EMPTY,
    closed: closed.length,
    skipped: list
      .filter((id) => !closed.some((row) => row.id === id))
      .map((id) => ({ id, reason: "not open" })),
  };
}

/** Put a selection back on the boards. Deleting still has no such door. */
export async function bulkRestoreRequests(ids: string[]): Promise<BulkOutcome> {
  const user = await requireUser();
  if (!canApproveIntoMaster(user.role)) {
    throw new Error("Not permitted.");
  }

  const list = unique(ids);
  if (list.length === 0) return { ...EMPTY, skipped: [] };

  const restored = await db
    .update(schema.requests)
    .set({ archivedAt: null })
    .where(
      and(
        inArray(schema.requests.id, list),
        isNotNull(schema.requests.archivedAt),
      ),
    )
    .returning({ id: schema.requests.id });

  revalidatePath("/requests");
  revalidatePath("/");
  for (const id of list) revalidatePath(`/requests/${id}`);

  return { ...EMPTY, restored: restored.length, skipped: [] };
}

const unique = (ids: string[]) =>
  [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : "could not be removed";

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
