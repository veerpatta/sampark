import {
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonTable,
} from "@/components/admin/Skeleton";

export default function MarksLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonTable
        headers={["Teacher", "Class", "Subject", "Entered", "Last entered"]}
      />
    </SkeletonPage>
  );
}
