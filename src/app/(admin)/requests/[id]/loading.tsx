import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/** Detail and status on the left; the share panel and export on the right. */
export default function RequestDetailLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader wide />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <SkeletonCard lines={6} heading={false} />
        <div className="space-y-6">
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="mt-4 h-20 w-full rounded-lg" />
            <div className="mt-4 flex flex-wrap gap-2">
              <SkeletonBlock className="h-10 w-40 rounded-lg" />
              <SkeletonBlock className="h-10 w-32 rounded-lg" />
              <SkeletonBlock className="h-10 w-28 rounded-lg" />
            </div>
          </section>
          <SkeletonCard lines={1} />
        </div>
      </div>
    </SkeletonPage>
  );
}
