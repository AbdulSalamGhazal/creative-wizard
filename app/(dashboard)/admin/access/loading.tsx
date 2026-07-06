import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton } from "@/components/layout/page-skeletons";

export default function AccessLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
