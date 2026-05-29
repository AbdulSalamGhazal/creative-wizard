import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listTags } from "@/db/queries/tags";
import { getRatingRules } from "@/db/queries/rating";
import { ProductsAdmin } from "@/components/product/products-admin";
import { PlatformsAdmin } from "@/components/platform/platforms-admin";
import { MappingsAdmin } from "@/components/platform/mappings-admin";
import { TagsTable } from "@/components/tag/tags-table";
import { RatingRulesAdmin } from "@/components/rating/rating-rules-admin";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "products", label: "Products" },
  { key: "tags", label: "Tags" },
  { key: "platforms", label: "Platforms" },
  { key: "mapping", label: "CSV mapping" },
  { key: "rating", label: "Rate rules" },
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Admin
        </div>
        <h1 className="font-display text-4xl tracking-tight">Configuration</h1>
        <p className="text-ink-2 text-sm mt-1">
          Manage the building blocks creatives reference — products, tags, and
          per-platform CSV column mappings — plus the Summary rating rules.
        </p>
      </div>

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
      {active === "rating" && <RatingRulesAdmin rules={await getRatingRules()} />}
    </div>
  );
}
