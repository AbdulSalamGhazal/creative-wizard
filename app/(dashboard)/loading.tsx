import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterStripSkeleton,
  HeaderSkeleton,
  KpiRowSkeleton,
  ChartCardSkeleton,
} from "@/components/layout/page-skeletons";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton right />

      <KpiRowSkeleton count={5} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChartCardSkeleton height="h-56" />
        </div>
        <ChartCardSkeleton height="h-56" />
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </div>
  );
}
