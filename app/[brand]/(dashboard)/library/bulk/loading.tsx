import { PageShell } from "@/components/layout/page-shell";
import { HeaderSkeleton, DropzoneSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function BulkCreativesLoading() {
  return (
    <PageShell width="import">
      <HeaderSkeleton back />
      <Skeleton className="h-24 w-full rounded-lg" />
      <DropzoneSkeleton />
    </PageShell>
  );
}
