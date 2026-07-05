import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function AuditLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      {/* Category filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-md" />
        ))}
      </div>
      <TableSkeleton rows={10} wide />
    </div>
  );
}
