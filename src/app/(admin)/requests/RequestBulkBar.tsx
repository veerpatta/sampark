"use client";

import { BulkBar, type BulkAction } from "@/components/admin/BulkBar";
import {
  bulkCloseRequests,
  bulkRemoveRequests,
  bulkRestoreRequests,
} from "./[id]/actions";

/**
 * The three verbs, over a selection of requests.
 *
 * THE ORDER MATTERS AND SO DOES CLOSE BEING HERE. `bulkRemoveRequests` refuses
 * anything still open — a live link must not vanish under a teacher mid-answer
 * — so without Close, selecting a round that finished yesterday and pressing
 * "Archive or delete" would skip every row and explain why nineteen times.
 *
 * ONE BUTTON FOR TWO OUTCOMES, because the database decides which. A request
 * that collected nothing is really deleted; one that collected answers is
 * archived, because `submissions.request_id` has no cascade and app_rw has
 * DELETE revoked on that table. The label says both and the toast reports the
 * split rather than a total. See removeRequest in [id]/actions.ts.
 *
 * No undo on the toast. Archiving has an inverse and deleting does not, and one
 * button that sometimes undoes and sometimes silently fails to would be worse
 * than saying nothing — which is the same reasoning the review queue uses.
 */
export function RequestBulkBar({
  showArchived,
  children,
}: {
  showArchived: boolean;
  children: React.ReactNode;
}) {
  const actions: BulkAction[] = [
    { label: "Close", run: bulkCloseRequests },
    {
      label: "Archive or delete",
      tone: "danger",
      confirm: (n) =>
        `Clear ${n} selected ${n === 1 ? "request" : "requests"}?\n\n` +
        "Any that collected answers are archived and can be put back. Any that " +
        "collected nothing are deleted for good — that part cannot be undone.",
      run: bulkRemoveRequests,
    },
  ];

  if (showArchived) {
    actions.unshift({ label: "Put back", run: bulkRestoreRequests });
  }

  return (
    <BulkBar name="id" actions={actions}>
      {children}
    </BulkBar>
  );
}
