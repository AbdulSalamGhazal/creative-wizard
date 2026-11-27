import {
  HeaderSkeleton,
  FilterBarSkeleton,
  TabRowSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function StoreOrdersLoading() {
  return (
    <div className="space-y-6">
      {/* `subtitle` stands in for the Salla connection line. */}
      <HeaderSkeleton eyebrow subtitle />
      <div className="space-y-2">
        <FilterBarSkeleton />
        {/* The status tabs: All + six stages. */}
        <TabRowSkeleton tabs={7} />
        <TableSkeleton rows={10} wide />
      </div>
    </div>
  );
}
