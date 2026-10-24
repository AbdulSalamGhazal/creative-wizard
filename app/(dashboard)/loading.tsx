import {
  FilterStripSkeleton,
  HeaderSkeleton,
} from "@/components/layout/page-skeletons";
import {
  DashboardMetricsSkeleton,
  OverviewSectionSkeleton,
} from "@/components/overview/dashboard-skeletons";

/** The Dashboard's first paint — the same section skeletons the page streams
 *  into (D11), so the hand-off from route loading to streaming is seamless. */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <FilterStripSkeleton />
      <HeaderSkeleton right />
      <DashboardMetricsSkeleton />
      <OverviewSectionSkeleton />
    </div>
  );
}
