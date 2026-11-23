import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton, KpiRowSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

/** A campaign's page: header + meta line, KPI tiles, the chart, its ad sets, its creatives. */
export default function ParentCampaignLoading() {
  return (
    <div className="space-y-6">
      {/* Header: the shared PageHeader's shape — back link, eyebrow, title,
          the meta line, and the controls on the right (D26). */}
      <div className="space-y-2">
        <HeaderSkeleton back eyebrow right />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>

      <KpiRowSkeleton count={4} cols="grid-cols-2 @xl/main:grid-cols-3 @3xl/main:grid-cols-4" />

      <Skeleton className="h-72 w-full rounded-lg" />
      {/* Ad sets, then creatives */}
      <TableSkeleton rows={5} wide />
      <TableSkeleton rows={6} wide />
    </div>
  );
}
