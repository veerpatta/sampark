"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { btn } from "@/components/ui/controls";
import { removeRequest, restoreRequest } from "./actions";

/**
 * Take a finished request off the boards, or put it back.
 *
 * The button says which of the two things it is about to do, because they are
 * not the same thing and the difference is not recoverable in one direction. A
 * request that collected nothing is deleted; one that collected answers is
 * archived, and the label says "Archive" before she taps rather than after. See
 * removeRequest in actions.ts for why the second case cannot be a delete no
 * matter what this component asked for.
 *
 * StatusControls next door deliberately does NOT confirm — closing is undoable
 * from the toast it raises, so a modal there would be a question with no stakes.
 * This one confirms, because deleting has no toast that can bring it back.
 *
 * Only rendered for a CLOSED request. A live link disappearing under a teacher
 * mid-answer is the failure this is ordered around.
 */
export function RemoveControls({
  requestId,
  audienceLabel,
  submissionCount,
  archived,
}: {
  requestId: string;
  audienceLabel: string;
  /** Submission rows on record. Zero means there is nothing to preserve. */
  submissionCount: number;
  archived: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const destroys = submissionCount === 0;

  if (archived) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await restoreRequest(requestId);
              router.refresh();
              toast({ message: "Back on the boards.", tone: "success" });
            })
          }
          className={btn()}
        >
          Put it back on the boards
        </button>
        <span className="text-xs text-[var(--color-ink-muted)]">
          Archived — hidden from the dashboard and the requests table. Nothing
          was deleted.
        </span>
      </div>
    );
  }

  function remove() {
    // window.confirm rather than a custom modal: this is the one screen in the
    // console where the browser's own dialog is an advantage, because it cannot
    // be styled into looking routine.
    const warning = destroys
      ? `Delete the ${audienceLabel} request for good?\n\nIt collected no answers, so nothing is lost. This cannot be undone.`
      : `Archive the ${audienceLabel} request?\n\nIt holds ${submissionCount} recorded ${
          submissionCount === 1 ? "answer" : "answers"
        }, so those are kept and the request is only hidden. You can put it back.`;
    if (!window.confirm(warning)) return;

    startTransition(async () => {
      const result = await removeRequest(requestId);
      if (result.outcome === "deleted") {
        // The page we are standing on no longer exists — leave before the
        // refresh renders a 404 at the user.
        toast({ message: `Deleted the ${audienceLabel} request.`, tone: "info" });
        router.push("/requests");
        router.refresh();
        return;
      }
      router.refresh();
      toast({
        message: `Archived. ${result.answers} recorded ${
          result.answers === 1 ? "answer is" : "answers are"
        } kept.`,
        tone: "info",
      });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className={`${btn({ tone: "danger" })} border-[var(--color-danger)]`}
      >
        {destroys ? "Delete this request" : "Archive this request"}
      </button>
      <span className="text-xs text-[var(--color-ink-muted)]">
        {destroys
          ? "It collected nothing, so it can go for good."
          : `It holds ${submissionCount} recorded ${
              submissionCount === 1 ? "answer" : "answers"
            } — those are kept and the request is hidden.`}
      </span>
    </div>
  );
}
