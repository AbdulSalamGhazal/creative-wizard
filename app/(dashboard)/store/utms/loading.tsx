import {
  HeaderSkeleton,
  FilterBarSkeleton,
  KpiRowSkeleton,
  ChartCardSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function StoreUtmsLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow />
      <FilterBarSkeleton />
      {/* The page's own shape: four coverage tiles, the sources trend and its
          table, the compare chart, the accuracy bars — so nothing jumps when
          the scans land. */}
      <KpiRowSkeleton count={4} cols="grid-cols-2 lg:grid-cols-4" />
      <ChartCardSkeleton />
      <TableSkeleton rows={8} wide />
      <ChartCardSkeleton />
      <ChartCardSkeleton height="h-40" />
    </div>
  );
}
