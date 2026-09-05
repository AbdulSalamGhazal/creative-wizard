import {
  HeaderSkeleton,
  KpiRowSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <KpiRowSkeleton count={4} cols="grid-cols-2 lg:grid-cols-4" />
      <TableSkeleton rows={10} wide />
    </div>
  );
}
