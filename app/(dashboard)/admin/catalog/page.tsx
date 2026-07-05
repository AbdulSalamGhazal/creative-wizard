import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
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
  { key: "products", label: "Products" },
  { key: "tags", label: "Tags" },
  { key: "platforms", label: "Platforms" },
  { key: "mapping", label: "CSV mapping" },
  { key: "rating", label: "Rate rules" },
  { key: "status", label: "Status" },
  { key: "brands", label: "Brands" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

/**
 * Configuration admin — Products, Tags, Platforms, CSV mapping, and the
 * Summary Rate rules under one page, switched via the `?tab=` query param so
 * each section stays server-rendered.
 */
export default async function CatalogAdminPage({ searchParams }: Props) {
  await requireAdmin();
  const { tab } = await searchParams;
  const active: TabKey =
    TABS.find((t) => t.key === tab)?.key ?? "products";

  return (
    <PageShell width="admin">
      <PageHeader eyebrow="Admin" title="Configuration" />

      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-line">
        {TABS.map((t) => {
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
