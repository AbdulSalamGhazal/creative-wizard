import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function CatalogLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <HeaderSkeleton eyebrow />
      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-line pb-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-md" />
        ))}
      </div>
      <TableSkeleton rows={6} wide />
    </div>
  );
}
