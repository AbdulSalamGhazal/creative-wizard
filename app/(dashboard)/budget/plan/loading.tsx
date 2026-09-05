import {
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
