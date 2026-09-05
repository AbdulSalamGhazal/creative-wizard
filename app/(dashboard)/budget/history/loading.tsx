import {
  HeaderSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
