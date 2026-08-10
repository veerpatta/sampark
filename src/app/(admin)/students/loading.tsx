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
      {/* These headers must match the board's columns. A skeleton describing a
          table that does not arrive is worse than no skeleton — it promises a
          shape and then rearranges under the reader's eyes. */}
      <SkeletonTable
        headers={[
          "",
          "Class",
          "Roll",
          "Name",
          "House",
          "Father",
          "Mobile",
          "Record",
          "Student ID",
        ]}
        rows={12}
      />
    </SkeletonPage>
  );
}
