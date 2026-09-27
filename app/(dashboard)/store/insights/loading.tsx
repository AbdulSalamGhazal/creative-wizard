import {
  HeaderSkeleton,
  FilterBarSkeleton,
  KpiRowSkeleton,
  ChartCardSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function StoreInsightsLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <FilterBarSkeleton />
      {/* The page's own shape: four KPI tiles, the trend, then the analyzer —
          so nothing jumps when the two scans land. */}
      <KpiRowSkeleton count={4} cols="grid-cols-2 lg:grid-cols-4" />
      <ChartCardSkeleton />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
