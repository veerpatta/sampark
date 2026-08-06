import {
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonTable,
} from "@/components/admin/Skeleton";

export default function AuditLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonTable
        headers={["When", "Student", "Field", "Change", "Decision", "By"]}
        rows={12}
      />
    </SkeletonPage>
  );
}
