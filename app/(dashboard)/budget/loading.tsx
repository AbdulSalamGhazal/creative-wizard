import {
  HeaderSkeleton,
  KpiRowSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <KpiRowSkeleton count={4} cols="grid-cols-2 lg:grid-cols-4" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    </div>
  );
}
