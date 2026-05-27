import { Skeleton } from "@/components/ui/skeleton";

export default function UploadsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="rounded-lg border border-line bg-surface">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full border-b border-line last:border-b-0 rounded-none" />
        ))}
      </div>
    </div>
  );
}
