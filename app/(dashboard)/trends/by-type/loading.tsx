import {
  FilterStripSkeleton,
  HeaderSkeleton,
  ChartCardSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function TrendsByTypeLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton back right />
      {/* Per-type summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ChartCardSkeleton height="h-20" />
        <ChartCardSkeleton height="h-20" />
        <ChartCardSkeleton height="h-20" />
      </div>
      <ChartCardSkeleton height="h-64" />
      <TableSkeleton rows={6} wide />
    </div>
  );
}
