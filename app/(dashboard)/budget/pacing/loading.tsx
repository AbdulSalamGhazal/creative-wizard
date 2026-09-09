import {
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors Pacing's real order: month bar → allocation check table → the
 *  controls row → the chart → the period table. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <Skeleton className="h-8 w-full rounded-md" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-40 rounded" />
        <TableSkeleton rows={6} wide />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
        <TableSkeleton rows={8} wide />
      </div>
    </div>
  );
}
