import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterStripSkeleton,
  HeaderSkeleton,
  ChartCardSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function TrendsVideoLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton back subtitle right />
      {/* Median-stats strip */}
      <Skeleton className="h-6 w-96 max-w-full" />
      {/* Retention curve + diagnostic scatter */}
      <ChartCardSkeleton height="h-72" />
      <ChartCardSkeleton height="h-64" />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
