import {
  HeaderSkeleton,
  FilterBarSkeleton,
  KpiRowSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <FilterBarSkeleton />
      {/* The page leads with four KPI tiles (orders · conv. · Δ · match rate);
          without them the table jumped down on load. */}
      <KpiRowSkeleton count={4} cols="grid-cols-2 lg:grid-cols-4" />
      <TableSkeleton rows={10} wide />
    </div>
  );
}
