import {
  HeaderSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

// Summary renders its filter bar first, then the header, then the grouped
// per-platform table.
export default function SummaryLoading() {
  return (
    <div className="space-y-6">
      <FilterBarSkeleton />
      <HeaderSkeleton subtitle right />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
