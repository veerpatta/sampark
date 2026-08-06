import {
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/** What we hold on the left, the history of changes on the right. */
export default function StudentDetailLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader wide />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <SkeletonCard lines={8} />
        <SkeletonCard lines={6} />
      </div>
    </SkeletonPage>
  );
}
