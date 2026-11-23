import { HeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function StoreProductCostsLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow />
      {/* The page is one table: products with their cost and 30-day sales. */}
      <TableSkeleton rows={10} />
    </div>
  );
}
