import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton } from "@/components/layout/page-skeletons";
import { LandingPageBodySkeleton } from "@/components/landing-page/landing-page-detail-skeleton";

/** First paint for a landing page — the shared header's shape (back link,
 *  eyebrow, title, the meta line, Edit on the right), then the same body
 *  skeleton the page streams into. */
export default function LandingPageDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <HeaderSkeleton back eyebrow right />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-48 rounded-md" />
        </div>
        <LandingPageBodySkeleton />
      </div>
    </div>
  );
}
