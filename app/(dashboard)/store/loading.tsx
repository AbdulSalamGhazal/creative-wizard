import {
  HeaderSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function StoreLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton subtitle />
      {/* Upload panel placeholder */}
      <Skeleton className="h-40 w-full rounded-lg" />
      <div className="space-y-2">
        <FilterBarSkeleton />
        <TableSkeleton rows={10} wide />
      </div>
    </div>
  );
}
