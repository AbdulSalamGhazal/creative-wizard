import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, can } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import { getRatingConfig } from "@/db/queries/rating";
import { getActiveAccountId, listAccounts } from "@/lib/tenant";
import { RatingRulesAdmin } from "@/components/rating/rating-rules-admin";
import { AccountsAdmin } from "@/components/account/accounts-admin";
import { StatusConfigAdmin } from "@/components/creative/status-config-admin";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ExclusionRulesAdmin } from "@/components/exclusions/exclusion-rules-admin";
import { listExclusionRules } from "@/db/queries/exclusion-rules";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, creatives, products } from "@/db/schema";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "rating", label: "Rate rules", perm: "config.rating" },
  { key: "status", label: "Status", perm: "config.brands" },
  { key: "brands", label: "Brands", perm: "config.brands" },
  { key: "exclusions", label: "Exclusions", perm: "record.exclude" },
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
 * Configuration admin — the settings with no more natural home: Rate rules,
 * Status, Brands and Exclusions, switched via the `?tab=` query param so each
 * section stays server-rendered.
 *
 * The 2026-09 IA pass moved the rest out to the surfaces they describe:
 * Products/Angles → the Library, CSV mapping (with Platforms merged in) → the
 * ads Uploads page, Store fields → Store uploads. MOVED_TABS keeps every old
 * `?tab=` URL working — those links are in people's bookmarks and in older
 * audit-log context.
 */
const MOVED_TABS: Record<string, string> = {
  products: "/creatives?tab=products",
  angles: "/creatives?tab=angles",
  tags: "/creatives?tab=angles", // pre-rename bookmarks (tag → angle, 2026-09)
  platforms: "/uploads?tab=mapping", // merged into CSV mapping
  mapping: "/uploads?tab=mapping",
  store_fields: "/store/uploads?tab=fields",
};
export default async function CatalogAdminPage({ searchParams }: Props) {
  const user = await auth();
  // Only the tabs this user is allowed to configure.
  const tabs = TABS.filter((t) => user && can(user, t.perm));
  if (tabs.length === 0) notFound();

  const { tab } = await searchParams;
  // A tab that moved: send the caller to its new home rather than silently
  // dropping them on Rate rules.
  if (tab && MOVED_TABS[tab]) redirect(MOVED_TABS[tab]!);
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
      {active === "exclusions" && <ExclusionsTab />}
    </PageShell>
  );
}

/**
 * The Exclusions tab: rule-based exclusions (record.exclude). Loads the rules
 * with live counts plus the campaign/creative pickers for the add-rule flow.
 */
async function ExclusionsTab() {
  const acct = await getActiveAccountId();
  const [rules, ruleCampaigns, ruleCreatives] = await Promise.all([
    listExclusionRules(),
    db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.accountId, acct))
      .orderBy(asc(campaigns.name)),
    db
      .select({ id: creatives.id, name: creatives.name, hint: products.name })
      .from(creatives)
      .innerJoin(products, eq(products.id, creatives.productId))
      .where(eq(creatives.accountId, acct))
      .orderBy(asc(creatives.name)),
  ]);
  return (
    <ExclusionRulesAdmin
      rules={rules}
      campaigns={ruleCampaigns}
      creatives={ruleCreatives}
    />
  );
}
