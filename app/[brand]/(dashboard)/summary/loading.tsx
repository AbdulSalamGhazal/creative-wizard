import {
  HeaderSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

// Summary renders its header, then the filter bar (header first, like every
// FilterShell page), then the grouped per-platform table.
export default function SummaryLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton subtitle right />
      <FilterBarSkeleton />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
