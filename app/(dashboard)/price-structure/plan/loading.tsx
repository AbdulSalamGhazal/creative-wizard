import { ChartCardSkeleton, HeaderSkeleton, KpiRowSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Plan page: the module header with its right-hand controls, then the toolbar card, six tiles, cost shares beside the riyal bars, the ROAS ladder, the sales mix. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow right />
      <Skeleton className="h-24 w-full rounded-lg" />
      <KpiRowSkeleton count={6} cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />
      <div className="grid gap-4 lg:grid-cols-2">
        <TableSkeleton rows={5} />
        <ChartCardSkeleton height="h-40" />
      </div>
      <ChartCardSkeleton height="h-28" />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
