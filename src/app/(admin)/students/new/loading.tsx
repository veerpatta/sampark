import { SkeletonCard, SkeletonPage, SkeletonPageHeader } from "@/components/admin/Skeleton";

export default function NewStudentLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader wide />
      <SkeletonCard lines={1} />
      <SkeletonCard lines={5} />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
    </SkeletonPage>
  );
}
