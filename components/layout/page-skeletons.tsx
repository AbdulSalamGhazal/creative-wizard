import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared skeleton building blocks for per-route `loading.tsx` files. They
 * mirror the shapes produced by PageShell / PageHeader / the filter bars and
 * DataTable, so a route's tailored skeleton is a short composition instead of a
 * hand-rolled copy that drifts from the real page.
 */

/** Full-bleed sticky FilterStrip placeholder (dashboard / funnel / trends). */
export function FilterStripSkeleton() {
  return <div className="-mx-6 -mt-6 mb-2 h-12 border-b border-line" />;
}

/** In-flow sticky filter-bar placeholder (summary / campaigns / library). */
export function FilterBarSkeleton() {
  return (
    <div className="-mx-6 px-6 py-3 border-b border-line">
      <div className="flex items-center gap-2 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-md" />
        ))}
      </div>
    </div>
  );
}

interface HeaderSkeletonProps {
  eyebrow?: boolean;
  back?: boolean;
  subtitle?: boolean;
  right?: boolean;
}

/** PageHeader placeholder — eyebrow/back + title + optional subtitle + right slot. */
export function HeaderSkeleton({
  eyebrow,
  back,
  subtitle,
  right,
}: HeaderSkeletonProps) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div>
        {(eyebrow || back) && <Skeleton className="h-3 w-20 mb-2" />}
        <Skeleton className="h-10 w-64" />
        {subtitle && <Skeleton className="h-3 w-72 mt-2" />}
      </div>
      {right && <Skeleton className="h-8 w-48 rounded-md" />}
    </div>
  );
}

/** A row of KPI tiles. Defaults to the 2 / sm:3 / lg:5 gap-3 grid; pass `cols`
 *  to mirror a different breakpoint set (funnel = 7, campaign detail = 4). */
export function KpiRowSkeleton({
  count = 5,
  cols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
}: {
  count?: number;
  cols?: string;
}) {
  return (
    <div className={`grid ${cols} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
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
  );
}

/** A bordered card wrapping a titled chart placeholder. */
export function ChartCardSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className={`${height} w-full`} />
    </div>
  );
}

/** A table placeholder — header strip + N rows inside the surface card. */
export function TableSkeleton({
  rows = 8,
  wide = false,
}: {
  rows?: number;
  wide?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden">
      <div className="h-9 border-b border-line bg-surface-2/40" />
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-3 py-2.5">
            <Skeleton className={wide ? "h-5 w-full" : "h-5 w-3/4"} />
          </div>
        ))}
      </div>
    </div>
  );
}
