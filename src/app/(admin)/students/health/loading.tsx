import { SkeletonCard, SkeletonPage, SkeletonPageHeader } from "@/components/admin/Skeleton";

export default function DataHealthLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader wide />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={8} />
      </div>
      <SkeletonCard lines={10} />
    </SkeletonPage>
  );
}
