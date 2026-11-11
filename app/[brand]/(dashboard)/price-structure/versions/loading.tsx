import { HeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Versions page: the module header with its right-hand controls, then the two cards side by side, then the all-versions table. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow right />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
      <TableSkeleton rows={4} wide />
    </div>
  );
}
