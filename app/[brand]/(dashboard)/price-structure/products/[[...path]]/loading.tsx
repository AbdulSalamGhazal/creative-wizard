import { HeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors Products & offers: the header, then the product list beside the product card and the offers. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow right />
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <TableSkeleton rows={5} />
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
