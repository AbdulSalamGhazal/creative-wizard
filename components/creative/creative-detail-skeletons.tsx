import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Creative detail's per-SECTION skeletons (D11, 2026-10). The page streams:
 * the editable header renders as soon as the creative and its status are in,
 * and the pager, the analytics and the records/activity follow — each holding
 * its place at its own height. `loading.tsx` composes the same pieces.
 */

/** The pager row. The Back link is real — it works while the sequence loads. */
export function PagerSkeleton({ backHref }: { backHref?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to library
        </Link>
      ) : (
        <Skeleton className="h-4 w-28" />
      )}
      <Skeleton className="h-8 w-[8.5rem] rounded-md" />
    </div>
  );
}

/** One headline tile without a breakdown (the detail page's tiles). */
function TileSkeleton() {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4 flex flex-col gap-3.5">
      <div>
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-7 w-24" />
      </div>
    </div>
  );
}

/** Inside the Analytics card: five tiles, the over-time chart, the campaigns table. */
export function AnalyticsBodySkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <TileSkeleton key={i} />
        ))}
      </div>
      <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-64 w-full" />
      </div>
      <div>
        <Skeleton className="h-4 w-24 mb-3" />
        <div className="rounded-lg border border-line bg-surface overflow-hidden">
          <div className="h-9 border-b border-line bg-surface-2/40" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-3 py-2.5 border-b border-line last:border-b-0">
              <Skeleton className="h-5 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** The records block (collapsed by default) and the activity feed. */
export function RecordsActivitySkeleton() {
  return (
    <>
      <div className="rounded-lg border border-line bg-surface px-4 py-3 flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="space-y-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </>
  );
}
