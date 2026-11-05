import { ChartCardSkeleton, HeaderSkeleton, KpiRowSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

/** Mirrors the Overview page: the module header with its right-hand controls, then the six tiles, the price structure table, the two charts. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow right />
      <KpiRowSkeleton count={6} cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />
      <TableSkeleton rows={10} wide />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
    </div>
  );
}
