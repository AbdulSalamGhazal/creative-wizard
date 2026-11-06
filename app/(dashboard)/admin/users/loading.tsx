import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton } from "@/components/layout/page-skeletons";

/** Mirrors the Team directory: toolbar, then one row per member. */
export default function TeamLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      {/* Toolbar: search · status · Invite */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 flex-1 basis-56 rounded-md" />
        <Skeleton className="h-8 w-64 rounded-md" />
        <Skeleton className="ml-auto h-8 w-20 rounded-md" />
      </div>
      {/* Member rows */}
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40 max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="hidden h-3 w-16 md:block" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
