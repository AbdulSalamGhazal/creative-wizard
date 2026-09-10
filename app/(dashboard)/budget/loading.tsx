import {
  HeaderSkeleton,
  KpiRowSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Overview's real order: the month bar (steppers left, controls
 *  right) → KPI tiles → the pacing verdict line → the reserve and revenue
 *  strips → four platform cards → the allocation check. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-8 w-56 rounded-md" />
        <Skeleton className="h-8 w-40 rounded-md" />
      </div>
      <KpiRowSkeleton count={4} cols="grid-cols-2 lg:grid-cols-4" />
      <Skeleton className="h-4 w-80 rounded" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40 rounded" />
        <TableSkeleton rows={6} wide />
      </div>
    </div>
  );
}
