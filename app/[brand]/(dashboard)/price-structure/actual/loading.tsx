import { ChartCardSkeleton, HeaderSkeleton, KpiRowSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Actual page: the module header, the range bar, six tiles, the waterfall beside the bridge, open orders, the product table. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton eyebrow right />
      <Skeleton className="h-9 w-full max-w-md rounded-md" />
      <KpiRowSkeleton count={6} cols="grid-cols-2 @2xl/main:grid-cols-3 @5xl/main:grid-cols-6" />
      <div className="grid gap-4 @5xl/main:grid-cols-2">
        <ChartCardSkeleton height="h-56" />
        <ChartCardSkeleton height="h-56" />
      </div>
      <TableSkeleton rows={4} />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
