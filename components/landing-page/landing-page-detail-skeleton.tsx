import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsBodySkeleton } from "@/components/creative/creative-detail-skeletons";

/** The streamed analytics body's shape: the creative page's (tiles, chart,
 *  campaigns table), then the Creatives table under it. */
export function LandingPageBodySkeleton() {
  return (
    <>
      <AnalyticsBodySkeleton />
      <div>
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-[185px] w-full rounded-lg" />
      </div>
    </>
  );
}
