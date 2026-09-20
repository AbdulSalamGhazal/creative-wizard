import {
  FilterBarSkeleton,
  HeaderSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Canvas page: header → filter bar → the insights chips → the
 *  canvas itself (the tall block) → the one-line legend. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton subtitle />
      <FilterBarSkeleton />
      <div className="space-y-3">
        <div className="flex gap-2">
          <Skeleton className="h-7 w-64 rounded-full" />
          <Skeleton className="h-7 w-52 rounded-full" />
        </div>
        <Skeleton className="h-[calc(100vh-17rem)] min-h-[420px] w-full rounded-lg" />
        <Skeleton className="h-3 w-80" />
      </div>
    </div>
  );
}
