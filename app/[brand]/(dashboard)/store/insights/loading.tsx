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
      <HeaderSkeleton eyebrow />
      <FilterBarSkeleton />
      {/* The page's own shape: six KPI tiles, the trend, products, the
          section cards two by two, then the explorer — so nothing jumps
          when the scans land. */}
      <KpiRowSkeleton count={6} cols="grid-cols-2 @3xl/main:grid-cols-3 @6xl/main:grid-cols-6" />
      <ChartCardSkeleton />
      <TableSkeleton rows={6} />
      <div className="grid gap-4 @4xl/main:grid-cols-2">
        <ChartCardSkeleton height="h-48" />
        <ChartCardSkeleton height="h-48" />
        <ChartCardSkeleton height="h-48" />
        <ChartCardSkeleton height="h-48" />
      </div>
      <TableSkeleton rows={8} wide />
    </div>
  );
}
