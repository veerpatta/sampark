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
      <SkeletonCard lines={3} />
    </SkeletonPage>
  );
}
