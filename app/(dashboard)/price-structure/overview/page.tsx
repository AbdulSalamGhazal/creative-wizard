import { requirePermission } from "@/lib/auth";
import { PRICE_STRUCTURE_GATE } from "@/lib/page-gates";
import { versionNameFor } from "@/db/queries/price-structure";
import { PageShell } from "@/components/layout/page-shell";
import { OverviewView } from "@/components/price-structure/overview/overview-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ v?: string }>;

/** "Overview · {version}" so two tabs on two versions are told apart (brief §6.0). */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const { v } = await searchParams;
  const name = await versionNameFor(v);
  return { title: name ? `Overview · ${name}` : "Overview" };
}

export default async function Page() {
  await requirePermission(PRICE_STRUCTURE_GATE);
  return (
    <PageShell>
      <OverviewView />
    </PageShell>
  );
}
