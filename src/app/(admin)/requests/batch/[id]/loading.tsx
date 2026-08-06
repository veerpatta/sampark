import {
  SkeletonBlock,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/** A progress card, then one row per link. */
export default function BatchLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-4 md:p-6">
        <SkeletonBlock className="h-6 w-40" />
        <SkeletonBlock className="mt-3 h-1.5 w-full rounded-full" />
      </section>
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonBlock
            key={index}
            className="h-20 w-full rounded-[var(--radius-card)]"
          />
        ))}
      </div>
    </SkeletonPage>
  );
}
