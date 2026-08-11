import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/** Four cards: who, what, who gets it, and the check before sending. */
export default function BulkSendLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-4 md:p-6">
        <SkeletonBlock className="h-4 w-40" />
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: 12 }, (_, index) => (
            <SkeletonBlock key={index} className="h-12 w-24 rounded-[var(--radius-control)]" />
          ))}
        </div>
      </section>
      <SkeletonCard lines={5} />
      <SkeletonCard lines={3} />
    </SkeletonPage>
  );
}
