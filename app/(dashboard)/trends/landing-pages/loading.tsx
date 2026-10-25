import {
  FilterStripSkeleton,
  HeaderSkeleton,
  ChartCardSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

/** Mirrors the page: strip, header with its range badge, the table, then the chart. */
export default function TrendsLandingPagesLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton eyebrow right />
      <TableSkeleton rows={5} wide />
      <ChartCardSkeleton height="h-64" />
    </div>
  );
}
