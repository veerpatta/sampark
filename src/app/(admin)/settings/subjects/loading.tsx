import {
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

export default function SubjectsLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={6} />
      <SkeletonCard lines={6} />
    </SkeletonPage>
  );
}
