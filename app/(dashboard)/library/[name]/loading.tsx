import { Skeleton } from "@/components/ui/skeleton";
import {
  AnalyticsBodySkeleton,
  PagerSkeleton,
  RecordsActivitySkeleton,
} from "@/components/creative/creative-detail-skeletons";

/** First paint for creative detail — the same section skeletons the page
 *  streams into (D11), plus the header's, which renders first. */
export default function CreativeDetailLoading() {
  return (
    <div className="space-y-6">
      <PagerSkeleton />

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

      {/* Analytics card: the title row, then the streamed body's skeleton */}
      <div className="rounded-xl border border-line bg-surface/40 p-4 md:p-6 space-y-8">
        <div className="flex items-end justify-between gap-3 border-b border-line pb-4">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-8 w-48 rounded-md" />
        </div>
        <AnalyticsBodySkeleton />
      </div>

      <RecordsActivitySkeleton />
    </div>
  );
}
