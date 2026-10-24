import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton, KpiRowSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function CampaignDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Header: the shared PageHeader's shape — back link, eyebrow, title,
          the badge row, and the controls on the right (D26). */}
      <div className="space-y-2">
        <HeaderSkeleton back right />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>

      {/* 4 KPI tiles */}
      <KpiRowSkeleton count={4} cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" />

      {/* Creative performance chart + table */}
      <Skeleton className="h-72 w-full rounded-lg" />
      <TableSkeleton rows={6} wide />
    </div>
  );
}
