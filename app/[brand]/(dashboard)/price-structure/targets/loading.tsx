import { ChartCardSkeleton, HeaderSkeleton, KpiRowSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

/** Mirrors the Targets page: the module header with its right-hand controls, then the targets editor, one tile per target, the distance chart, the matrix. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow right />
      <TableSkeleton rows={3} />
      <KpiRowSkeleton count={2} cols="grid-cols-1 sm:grid-cols-2" />
      <ChartCardSkeleton height="h-56" />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
