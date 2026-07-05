import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton, ChartCardSkeleton } from "@/components/layout/page-skeletons";

export default function CompareLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton subtitle />
      {/* Side / metric controls */}
      <Skeleton className="h-16 w-full rounded-lg" />
      {/* One chart card per compared metric */}
      <ChartCardSkeleton height="h-64" />
      <ChartCardSkeleton height="h-64" />
    </div>
  );
}
