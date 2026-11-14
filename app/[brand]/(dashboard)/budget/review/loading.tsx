import { ChartCardSkeleton, HeaderSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { panelClass } from "@/components/ui/panel";

/** Mirrors Review's real order: the span and view controls → three summary
 *  tiles → the planned-vs-actual chart → the month cards → the change log. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-8 w-80 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="grid grid-cols-1 gap-3 @2xl/main:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border border-line bg-surface px-4 py-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
        <ChartCardSkeleton height="h-56 sm:h-64" />
        <div className="grid grid-cols-1 gap-2 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={panelClass({ padding: "sm" })}>
              <Skeleton className="h-4 w-32" />
              <div className="mt-3 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
        <div className={panelClass({ padding: "none" })}>
          <div className="border-b border-line px-4 py-2.5">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
