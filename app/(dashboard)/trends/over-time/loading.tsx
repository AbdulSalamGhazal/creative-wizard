import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterStripSkeleton,
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function TrendsChangesLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton back subtitle right />
      {/* Account-overall context strip */}
      <Skeleton className="h-12 w-full rounded-lg" />
      {/* Breakdown selector */}
      <Skeleton className="h-8 w-56 rounded-md" />
      {/* Change radar rows */}
      <TableSkeleton rows={8} wide />
    </div>
  );
}
