import { HeaderSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the real page: header → tabs + filters row → the list of rows. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton subtitle />
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
