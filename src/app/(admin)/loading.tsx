import {
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonStatGrid,
} from "@/components/admin/Skeleton";

/**
 * The dashboard.
 *
 * Note that this file is also the fallback for any child segment that has none
 * of its own — so every segment under (admin) has one, or a stat grid would
 * flash before a table.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonStatGrid />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={5} />
      </div>
    </SkeletonPage>
  );
}
