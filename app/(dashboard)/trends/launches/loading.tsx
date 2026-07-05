import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterStripSkeleton,
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function TrendsLaunchesLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton back subtitle right />
      {/* Fatigue summary strip */}
      <Skeleton className="h-24 w-full rounded-lg" />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
