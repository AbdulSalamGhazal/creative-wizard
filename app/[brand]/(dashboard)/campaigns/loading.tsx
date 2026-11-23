import {
  HeaderSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

/** The Campaigns list — header, filter bar, the roll-up table. */
export default function CampaignsLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton subtitle right />
      <FilterBarSkeleton />
      <TableSkeleton rows={10} wide />
    </div>
  );
}
