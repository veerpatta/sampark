import {
  SkeletonBlock,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/** The round's progress, then the send queue's card, then one row per link. */
export default function BatchLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      {/* The round progress card, which is now what loads first and is the
          tallest thing above the fold — a skeleton that stopped at the send
          queue would jump the page by most of a screen when it resolved. */}
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-4 md:p-6">
        <SkeletonBlock className="h-6 w-56" />
        <SkeletonBlock className="mt-3 h-2 w-full rounded-full" />
        <SkeletonBlock className="mt-3 h-4 w-64" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBlock
              key={index}
              className="h-12 w-full rounded-[var(--radius-control)]"
            />
          ))}
        </div>
      </section>
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
