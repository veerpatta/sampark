import { SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/admin/Skeleton";

export default function MarksGridLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader wide />
      <SkeletonTable headers={["Roll", "Name", "Subject", "Subject", "Subject"]} rows={12} />
    </SkeletonPage>
  );
}
