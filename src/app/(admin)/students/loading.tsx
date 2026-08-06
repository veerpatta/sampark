import {
  SkeletonFilterBar,
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonTable,
} from "@/components/admin/Skeleton";

export default function StudentsLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonFilterBar />
      <SkeletonTable
        headers={["Class", "Roll", "Name", "Father", "Mobile", "Student ID", "SR"]}
        rows={12}
      />
    </SkeletonPage>
  );
}
