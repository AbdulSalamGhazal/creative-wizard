import {
  HeaderSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function StoreOrdersLoading() {
  return (
    <div className="space-y-6">
      {/* `subtitle` stands in for the Salla connection line. */}
      <HeaderSkeleton eyebrow subtitle />
      <div className="space-y-2">
        <FilterBarSkeleton />
        <TableSkeleton rows={10} wide />
      </div>
    </div>
  );
}
