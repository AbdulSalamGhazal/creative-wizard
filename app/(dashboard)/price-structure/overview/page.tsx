import { requirePriceStructureAccess, VIEW_PERM } from "@/lib/price-structure-access";
import { refusable } from "@/lib/auth";
import { AccessRefused } from "@/components/layout/access-refused";
import { versionNameFor } from "@/db/queries/price-structure";
import { PageShell } from "@/components/layout/page-shell";
import { OverviewView } from "@/components/price-structure/overview/overview-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ v?: string }>;

/** "Overview · {version}" so two tabs on two versions are told apart (brief §6.0). */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const { v } = await searchParams;
  const name = await versionNameFor(v);
  return { title: name ? `Price structure · Overview · ${name}` : "Price structure · Overview" };
}

export default async function Page() {
  if (!(await refusable(() => requirePriceStructureAccess()))) {
    return <AccessRefused page="Price structure" perm={VIEW_PERM} />;
  }
  return (
    <PageShell>
      <OverviewView />
    </PageShell>
  );
}
