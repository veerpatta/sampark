import {
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonTable,
} from "@/components/admin/Skeleton";

export default function RequestsLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonTable
        headers={[
          "Class",
          "Request",
          "Teacher",
          "Answered",
          "To review",
          "Due",
          "Status",
        ]}
      />
    </SkeletonPage>
  );
}
