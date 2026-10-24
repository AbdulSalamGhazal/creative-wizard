import { HeaderSkeleton, DropzoneSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function BulkCreativesLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <HeaderSkeleton back />
      <Skeleton className="h-24 w-full rounded-lg" />
      <DropzoneSkeleton />
    </div>
  );
}
