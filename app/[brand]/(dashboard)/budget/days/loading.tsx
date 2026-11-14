import { HeaderSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { panelClass } from "@/components/ui/panel";

/** Mirrors Daily's real order: the month bar with its three controls → the
 *  summary line → the month calendar beside the picked day's panel. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-8 w-72 rounded-md" />
        </div>
        <Skeleton className="h-3 w-56 rounded-sm" />
        <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @4xl/main:items-start">
          <div className={panelClass({ padding: "sm" })}>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-md sm:h-16" />
              ))}
            </div>
          </div>
          <div className={panelClass({ padding: "none" })}>
            <div className="space-y-2 border-b border-line px-4 py-2.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-56" />
            </div>
            <div className="divide-y divide-line">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
