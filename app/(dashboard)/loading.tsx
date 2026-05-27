import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <Skeleton className="h-3 w-16 mb-2" />
          <Skeleton className="h-10 w-72" />
        </div>
        <Skeleton className="h-6 w-56 rounded-md" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-line bg-surface p-4 space-y-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-2 w-28" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg border border-line bg-surface p-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-56 w-full" />
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-56 w-full" />
        </div>
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
