import { HeaderSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors Pacing's real order: header → the controls bar (date picker,
 *  platform pill, group-by, split, currency) → the range card → the chart
 *  card (the period table under it is closed) → the board: a header line and
 *  one grid row per platform. */
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
      <Skeleton className="h-4 w-24" />
      <div className="rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-48 rounded-md" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 border-b border-line px-4 py-3 last:border-b-0">
            <div className="grid gap-x-4 sm:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_6.5rem_11rem] sm:items-center">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="hidden h-5 w-full sm:block" />
              <Skeleton className="h-4 w-full" />
            </div>
            <div className="grid gap-x-4 sm:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_6.5rem_11rem] sm:items-center">
              <Skeleton className="ml-5 h-3 w-20" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="hidden h-4 w-full sm:block" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
