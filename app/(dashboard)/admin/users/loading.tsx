import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function UsersLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      {/* Invite form card */}
      <Skeleton className="h-24 w-full rounded-lg" />
      <TableSkeleton rows={6} wide />
    </div>
  );
}
