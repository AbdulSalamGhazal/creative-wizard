import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, can } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import { listTags } from "@/db/queries/tags";
import { getRatingConfig } from "@/db/queries/rating";
import { getActiveAccountId, listAccounts } from "@/lib/tenant";
import { ProductsAdmin } from "@/components/product/products-admin";
import { PlatformsAdmin } from "@/components/platform/platforms-admin";
import { MappingsAdmin } from "@/components/platform/mappings-admin";
import { TagsTable } from "@/components/tag/tags-table";
import { RatingRulesAdmin } from "@/components/rating/rating-rules-admin";
import { AccountsAdmin } from "@/components/account/accounts-admin";
import { StatusConfigAdmin } from "@/components/creative/status-config-admin";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "products", label: "Products", perm: "catalog.products" },
  { key: "tags", label: "Tags", perm: "catalog.tags" },
  { key: "platforms", label: "Platforms", perm: "config.mappings" },
  { key: "mapping", label: "CSV mapping", perm: "config.mappings" },
  { key: "rating", label: "Rate rules", perm: "config.rating" },
  { key: "status", label: "Status", perm: "config.brands" },
  { key: "brands", label: "Brands", perm: "config.brands" },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  perm: Permission;
}>;
type TabKey = (typeof TABS)[number]["key"];

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

export const metadata = { title: "Configuration" };

/**
 * Configuration admin — Products, Tags, Platforms, CSV mapping, and the
 * Summary Rate rules under one page, switched via the `?tab=` query param so
 * each section stays server-rendered.
 */
export default async function CatalogAdminPage({ searchParams }: Props) {
  const user = await auth();
  // Only the tabs this user is allowed to configure.
  const tabs = TABS.filter((t) => user && can(user, t.perm));
  if (tabs.length === 0) notFound();

  const { tab } = await searchParams;
  const requested = tabs.find((t) => t.key === tab);
  // Redirect an unpermitted/unknown tab to the first one they can see.
  if (!requested) redirect(`/admin/catalog?tab=${tabs[0]!.key}`);
  const active: TabKey = requested.key;

  return (
    <PageShell width="admin">
      <PageHeader eyebrow="Admin" title="Configuration" />

      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-line">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={`/admin/catalog?tab=${t.key}`}
              scroll={false}
              className={
                "relative px-3 py-2 text-sm transition-colors -mb-px border-b-2 " +
                (isActive
                  ? "border-brand text-ink"
                  : "border-transparent text-ink-2 hover:text-ink")
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {active === "products" && <ProductsAdmin />}
      {active === "tags" && <TagsTable rows={await listTags()} />}
      {active === "platforms" && <PlatformsAdmin />}
      {active === "mapping" && <MappingsAdmin />}
      {active === "rating" && <RatingRulesAdmin config={await getRatingConfig()} />}
      {active === "status" && (
        <StatusConfigAdmin brands={await listAccounts()} />
      )}
      {active === "brands" && (
        <AccountsAdmin
          accounts={await listAccounts()}
          activeId={await getActiveAccountId()}
        />
      )}
    </PageShell>
  );
}
