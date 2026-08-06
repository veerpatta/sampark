import {
  SkeletonBlock,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/**
 * The queue groups by class, and each group is a headerless table of proposed
 * changes with a checkbox on every row. Two groups is enough to say so.
 */
export default function ReviewLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      {Array.from({ length: 2 }, (_, group) => (
        <section
          key={group}
          className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
        >
          <header className="flex items-baseline gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <SkeletonBlock className="h-5 w-32" />
            <SkeletonBlock className="h-4 w-48" />
          </header>
          <ul className="divide-y divide-[var(--color-border)]">
            {Array.from({ length: 4 }, (_, row) => (
              <li key={row} className="flex items-center gap-4 px-4 py-3">
                <SkeletonBlock className="h-4 w-4 shrink-0" />
                <SkeletonBlock className="h-5 w-40" />
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-4 w-32" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SkeletonPage>
  );
}
