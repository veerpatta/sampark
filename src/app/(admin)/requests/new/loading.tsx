import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/** Three numbered cards: class, fields, teacher and due date. */
export default function NewRequestLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-6">
        <SkeletonBlock className="h-4 w-32" />
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: 11 }, (_, index) => (
            <SkeletonBlock key={index} className="h-10 w-24 rounded-[var(--radius-control)]" />
          ))}
        </div>
      </section>
      <SkeletonCard lines={5} />
      <SkeletonCard lines={3} />
    </SkeletonPage>
  );
}
