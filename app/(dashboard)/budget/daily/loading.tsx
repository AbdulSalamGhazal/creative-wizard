import {
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <Skeleton className="h-9 w-64 rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
      <TableSkeleton rows={12} wide />
    </div>
  );
}
