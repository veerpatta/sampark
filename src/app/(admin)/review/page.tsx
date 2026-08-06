import { canApproveIntoMaster, currentUser } from "@/lib/auth/session";
import { listPendingReview } from "@/lib/submissions";
import { ReviewQueue } from "./ReviewQueue";

export const metadata = { title: "Review — Sampark" };
export const dynamic = "force-dynamic";

/**
 * The approval queue.
 *
 * Only things that actually differ from what the teacher was shown appear here.
 * A confirmation that matched the snapshot is recorded with review_status
 * 'auto' and never reaches this screen — the office should not have to click
 * through forty "yes, that was already right" rows to find the three that
 * changed.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const params = await searchParams;
  const [session, items] = await Promise.all([
    currentUser(),
    listPendingReview(params.request),
  ]);

  const actionable = items.filter((item) => !item.superseded);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-display font-semibold tracking-tight">Review</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {actionable.length === 0
            ? "Nothing waiting."
            : `${actionable.length} proposed change${actionable.length === 1 ? "" : "s"} waiting`}
        </p>
      </header>

      {items.length === 0 ? (
        <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-muted)]">
          <p className="font-medium text-[var(--color-ink)]">
            The queue is empty.
          </p>
          <p className="mt-2">
            Changes appear here when a teacher corrects something. Confirmations
            that match what she was sent are recorded but never queued — there is
            nothing to decide about them.
          </p>
        </section>
      ) : (
        <ReviewQueue
          items={items}
          canApprove={session ? canApproveIntoMaster(session.role) : false}
        />
      )}
    </div>
  );
}
