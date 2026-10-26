import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton } from "@/components/layout/page-skeletons";

/**
 * Mirrors the real page inside its admin lane: the header with the
 * Everyone | Mine switch → the search + chips bar → day groups, each a run
 * card with its anchor line and comment rows.
 */
export default function ActivityLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <HeaderSkeleton right />
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="space-y-4">
        {[3, 1, 2].map((rows, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <div className="rounded-lg border border-line bg-surface">
              <div className="px-3 pt-2.5 pb-1">
                <Skeleton className="h-4 w-48" />
              </div>
              {Array.from({ length: rows }).map((_, j) => (
                <div key={j} className="flex gap-3 px-3 py-3">
                  <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
