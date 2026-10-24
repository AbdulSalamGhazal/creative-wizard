import { ChartCardSkeleton, HeaderSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Overview's real order: the month bar (steppers left, controls
 *  right) and its coverage line → the three hero cards → the cumulative chart
 *  → the pace board's rows. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow />
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-8 w-56 rounded-md" />
            <Skeleton className="h-8 w-40 rounded-md" />
          </div>
          <Skeleton className="h-3 w-64 rounded" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border border-line bg-surface px-4 py-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
        <ChartCardSkeleton height="h-56 sm:h-64" />
        <div className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 px-4 py-3">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-2 flex-1 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="flex items-center gap-4 pl-5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-1.5 flex-1 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
