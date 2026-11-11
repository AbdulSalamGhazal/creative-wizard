import {
  FilterStripSkeleton,
  HeaderSkeleton,
  KpiRowSkeleton,
  ChartCardSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function FunnelLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton eyebrow right />

      {/* 7 headline funnel-rate tiles */}
      <KpiRowSkeleton count={7} cols="grid-cols-2 sm:grid-cols-4 xl:grid-cols-7" />

      <ChartCardSkeleton height="h-64" />
      <TableSkeleton rows={5} wide />
      <TableSkeleton rows={6} wide />
    </div>
  );
}
