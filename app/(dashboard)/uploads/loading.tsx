import {
  HeaderSkeleton,
  TabRowSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

export default function UploadsLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle right />
      <TabRowSkeleton />
      <TableSkeleton rows={5} wide />
    </div>
  );
}
