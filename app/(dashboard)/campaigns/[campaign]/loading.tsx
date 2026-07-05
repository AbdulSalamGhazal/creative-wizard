import { Skeleton } from "@/components/ui/skeleton";
import { KpiRowSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function CampaignDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Header: back-link + title + actions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>

      {/* 4 KPI tiles */}
      <KpiRowSkeleton count={4} cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" />

      {/* Creative performance chart + table */}
      <Skeleton className="h-72 w-full rounded-lg" />
      <TableSkeleton rows={6} wide />
    </div>
  );
}
