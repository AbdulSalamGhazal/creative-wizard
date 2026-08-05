import {
  HeaderSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <FilterBarSkeleton />
      <TableSkeleton rows={10} wide />
    </div>
  );
}
