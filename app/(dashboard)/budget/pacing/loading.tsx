import {
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors Pacing's real order: header → the controls card (date picker,
 *  platform pill, group-by, objective toggle, currency) → the chart card →
 *  the wide period table. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-80 w-full rounded-lg" />
      <TableSkeleton rows={10} wide />
    </div>
  );
}
