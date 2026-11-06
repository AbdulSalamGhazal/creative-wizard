import { requirePriceStructureAccess } from "@/lib/price-structure-access";
import { versionNameFor } from "@/db/queries/price-structure";
import { PageShell } from "@/components/layout/page-shell";
import { PlanView } from "@/components/price-structure/plan/plan-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ v?: string }>;

/** "Plan · {version}" so two tabs on two versions are told apart (brief §6.0). */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const { v } = await searchParams;
  const name = await versionNameFor(v);
  return { title: name ? `Plan · ${name}` : "Plan" };
}

export default async function Page() {
  await requirePriceStructureAccess();
  return (
    <PageShell>
      <PlanView />
    </PageShell>
  );
}
