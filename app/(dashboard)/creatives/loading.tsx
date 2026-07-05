import {
  HeaderSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "@/components/layout/page-skeletons";

// The Library defaults to the TABLE view, so its skeleton mirrors the table
// (not the card grid). The header carries an eyebrow, status summary, and the
// import / new-creative actions.
export default function CreativesLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton eyebrow subtitle right />
      <FilterBarSkeleton />
      <TableSkeleton rows={8} wide />
    </div>
  );
}
