import { HeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

/** Mirrors the SKU mapping page: the header with its back link and version bar, the SKU list, the ad-product list. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton eyebrow right />
      <TableSkeleton rows={8} />
      <TableSkeleton rows={4} />
    </div>
  );
}
