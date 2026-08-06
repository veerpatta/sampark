import {
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonTable,
} from "@/components/admin/Skeleton";

export default function UsersLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonCard lines={3} />
      <SkeletonTable headers={["Name", "Email", "Role", "Since"]} rows={5} />
    </SkeletonPage>
  );
}
