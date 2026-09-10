import {
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Plan page's view mode: the month bar (steppers left, controls
 *  right) → the totals strip → the allocations table → the plan-curve card. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-8 w-56 rounded-md" />
        <Skeleton className="h-8 w-72 rounded-md" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <TableSkeleton rows={7} />
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}
