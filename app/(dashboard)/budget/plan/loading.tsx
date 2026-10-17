import { HeaderSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Plan page's view mode: the month bar (steppers left, the
 *  toolbar right) → the targets strip → the composition bar with its legend
 *  → the 2×2 platform cards → the plan-curve line. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-8 w-72 rounded-md" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-7 w-full rounded-md" />
          <div className="flex flex-wrap gap-4">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-48 rounded" />
      </div>
    </div>
  );
}
