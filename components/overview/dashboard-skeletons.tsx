import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Dashboard's per-SECTION skeletons (D11, 2026-10). The page now streams:
 * the KPI tiles (≈7 of its 30-odd queries) render as soon as their numbers
 * are in, and the overview below follows — each section holds its place with
 * a skeleton of its own shape and height, so nothing jumps when it lands.
 * The route's `loading.tsx` composes the same pieces for the first paint.
 */

/** One KPI tile: label row, headline, and the per-platform breakdown bars. */
export function MetricCardSkeleton({ bars = 3 }: { bars?: number }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4 flex flex-col gap-3.5">
      <div>
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-7 w-24" />
      </div>
      <ul className="space-y-1.5">
        {Array.from({ length: bars }).map((_, i) => (
          <li key={i} className="flex h-[16.5px] items-center gap-1.5">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-2.5 w-[4.5rem]" />
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-2.5 w-8" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The five headline tiles, in the tiles' own grid. */
export function DashboardMetricsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** A Card with a title row and a body of the given height. */
function CardSkeleton({ body, title = "w-32" }: { body: string; title?: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface py-4">
      <div className="px-4">
        <Skeleton className={`h-4 ${title}`} />
      </div>
      <div className="px-4">
        <Skeleton className={`${body} w-full`} />
      </div>
    </div>
  );
}

/**
 * The overview, section by section: the over-time chart, the three mixes,
 * movers + funnel rates, the status flow, rating mix + correlation, and the
 * top-creatives table — each at the height it renders at.
 */
export function OverviewSectionSkeleton() {
  return (
    <section className="space-y-4" aria-hidden>
      <CardSkeleton body="h-[19rem]" title="w-44" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CardSkeleton body="h-56" title="w-24" />
        <CardSkeleton body="h-56" title="w-24" />
        <CardSkeleton body="h-56" title="w-28" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CardSkeleton body="h-64" title="w-28" />
        <CardSkeleton body="h-64" title="w-28" />
      </div>
      <CardSkeleton body="h-48" title="w-24" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CardSkeleton body="h-64" title="w-24" />
        <CardSkeleton body="h-64" title="w-36" />
      </div>
      <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </section>
  );
}
