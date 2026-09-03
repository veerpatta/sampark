import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonPage,
  SkeletonPageHeader,
} from "@/components/admin/Skeleton";

/** The header, the section chips, then the five sections in the page's shape. */
export default function StudentDetailLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHeader wide />
      <div className="flex gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBlock key={index} className="h-9 w-20 rounded-[var(--radius-chip)]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={9} />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={5} />
        <SkeletonCard lines={2} />
      </div>
      <SkeletonCard lines={2} />
      <SkeletonCard lines={6} />
    </SkeletonPage>
  );
}
