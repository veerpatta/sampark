import {
  SkeletonBlock,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/** The wizard opens on a file drop zone; everything after it is client-side. */
export default function ImportLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <SkeletonBlock className="h-4 w-56" />
        <SkeletonBlock className="mt-4 h-28 w-full rounded-[var(--radius-control)]" />
      </section>
    </SkeletonPage>
  );
}
