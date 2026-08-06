import {
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonTable,
} from "@/components/admin/Skeleton";

export default function TeachersLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonCard lines={3} />
      <SkeletonTable headers={["ID", "Name", "Phone", "Classes"]} rows={10} />
    </SkeletonPage>
  );
}
