import { Skeleton } from "@/components/ui/skeleton";
import { KpiRowSkeleton } from "@/components/layout/page-skeletons";

export default function CreativeDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Pager */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Information: thumbnail + editable header */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        <Skeleton className="aspect-[4/3] w-full rounded-lg" />
        <div className="space-y-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-10 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 rounded-md" />
            <Skeleton className="h-6 w-20 rounded-md" />
            <Skeleton className="h-6 w-24 rounded-md" />
          </div>
        </div>
      </div>

      {/* Analytics: 5 KPI tiles + charts */}
      <div className="rounded-xl border border-line bg-surface/40 p-4 md:p-6 space-y-6">
        <KpiRowSkeleton count={5} />
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  );
}
