import { requirePriceStructureAccess, VIEW_PERM } from "@/lib/price-structure-access";
import { refusable } from "@/lib/auth";
import { AccessRefused } from "@/components/layout/access-refused";
import { versionNameFor } from "@/db/queries/price-structure";
import { PageShell } from "@/components/layout/page-shell";
import { TargetsView } from "@/components/price-structure/targets/targets-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ v?: string }>;

/** "Targets · {version}" so two tabs on two versions are told apart (brief §6.0). */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const { v } = await searchParams;
  const name = await versionNameFor(v);
  return { title: name ? `Targets · ${name}` : "Targets" };
}

export default async function Page() {
  if (!(await refusable(() => requirePriceStructureAccess()))) {
    return <AccessRefused page="Price structure" perm={VIEW_PERM} />;
  }
  return (
    <PageShell>
      <TargetsView />
    </PageShell>
  );
}
