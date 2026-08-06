import {
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
  SkeletonTable,
} from "@/components/admin/Skeleton";

export default function FieldsLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonCard lines={4} />
      <SkeletonTable
        headers={["Key", "Label", "Mode", "Type", "Writes to", "Rule"]}
        rows={10}
      />
    </SkeletonPage>
  );
}
