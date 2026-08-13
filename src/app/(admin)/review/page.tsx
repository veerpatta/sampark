import Link from "next/link";
import { canApproveIntoMaster, currentUser } from "@/lib/auth/session";
import { listPendingReview } from "@/lib/submissions";
import { PageHeader } from "@/components/admin/PageHeader";
import { ReviewQueue } from "./ReviewQueue";

export const metadata = { title: "Review — Sampark" };
export const dynamic = "force-dynamic";

/**
 * The approval queue, for the master record.
 *
 * Only things that actually differ from what the teacher was shown appear here.
 * A confirmation that matched the snapshot is recorded with review_status
 * 'auto' and never reaches this screen — the office should not have to click
 * through forty "yes, that was already right" rows to find the three that
 * changed.
 *
 * NEITHER DO MARKS, and that is the newer half of the same idea. A mark is not
 * a proposed change to anything: it is written at submit time and this screen
 * never sees it (lib/submissions.ts). What is left here is exactly what it was
 * always for — a teacher correcting something the school already holds, where
 * approving it settles an argument between two sources. See /marks for a round.
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
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        title="Review"
        subtitle={
          actionable.length === 0
            ? "Nothing waiting. Marks are not queued here — see Marks."
            : `${actionable.length} proposed change${actionable.length === 1 ? "" : "s"} waiting. Nothing is in the master record until you approve it.`
        }
      />

      {items.length === 0 ? (
        <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-ink-muted)] md:p-6">
          <p className="font-medium text-[var(--color-ink)]">
            The queue is empty.
          </p>
          <p className="mt-2">
            Changes appear here when a teacher corrects something the school
            already holds — a phone number, a parent&rsquo;s name, a date of
            birth. Confirmations that match what she was sent are recorded but
            never queued: there is nothing to decide about them.
          </p>
          <p className="mt-2">
            <strong className="font-medium text-[var(--color-ink)]">
              An empty queue does not mean no marks came in.
            </strong>{" "}
            Marks and answers to one-off questions are not proposed changes to
            the master record — they are the record — so they go straight in and
            never appear here.{" "}
            <Link
              href="/marks"
              className="font-medium text-[var(--color-brand-600)] hover:underline"
            >
              See Marks
            </Link>{" "}
            for how a round is going.
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
