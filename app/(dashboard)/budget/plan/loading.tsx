import {
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Plan page's real order: month bar → revenue/reserve strip → the
 *  day-curve card → the (now three-column, so narrow) allocations table. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <Skeleton className="h-8 w-full rounded-md" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <TableSkeleton rows={7} />
    </div>
  );
}
