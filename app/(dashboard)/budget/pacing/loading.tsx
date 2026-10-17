import { HeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors Pacing's real order: header → the controls bar (date picker,
 *  platform pill, group-by, split, currency) → the range card → the chart
 *  card → the wide period table. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="space-y-3 rounded-lg border border-line bg-surface px-4 py-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-3 w-64" />
      </div>
      <Skeleton className="h-80 w-full rounded-lg" />
      <TableSkeleton rows={10} wide />
    </div>
  );
}
