import {
  FilterStripSkeleton,
  HeaderSkeleton,
  ChartCardSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function TrendsByTagLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton back subtitle right />
      {/* Efficiency scatter + ranked leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCardSkeleton height="h-64" />
        <ChartCardSkeleton height="h-64" />
      </div>
      <ChartCardSkeleton height="h-56" />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
