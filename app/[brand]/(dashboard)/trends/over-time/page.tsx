import { Badge } from "@/components/ui/badge";
import { ParamSwitch } from "@/components/filters/param-switch";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  changeBreakdown,
  kpisWithDelta,
  type ChangeDim,
  type KpiFilters,
} from "@/db/queries/performance";
import { defaultDateRange } from "@/lib/date-presets";
import {
  resolveIncludeExcluded,
  resolvePreferredRange,
  resolveStripFilters,
} from "@/db/queries/user-prefs";
import { listProducts } from "@/db/queries/products";
import { listAllAngles } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import {
  ChangeRadar,
  type ChangeRadarRow,
} from "@/components/trends/change-radar";
import { assessChange, CHANGE_TIER_ORDER } from "@/lib/change-radar";
import {
  CHANGE_DIM_DEFAULT,
  changeDimSchema,
  dashboardFiltersSchema,
  STRIP_FILTER_KEYS,
} from "@/validators/filters";
import { PLATFORM_LABEL, ALL_PLATFORMS } from "@/lib/palette";
import { usd, roas } from "@/lib/format";
import { pickFirst } from "@/lib/url";
import { adSetPath, campaignPath } from "@/lib/campaign";
import { AdDataGate } from "@/components/ui/no-ad-data-state";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

// `campaign` is the AD SET (the stored word), `parent_campaign` the CAMPAIGN —
// the default since 2026-11, and so the clean URL.
const DIMS: Array<{ value: ChangeDim; label: string }> = [
  { value: "platform", label: "Platform" },
  { value: "parent_campaign", label: "Campaign" },
  { value: "campaign", label: "Ad set" },
  { value: "creative", label: "Creative" },
];

type SearchParams = Record<string, string | string[] | undefined>;

function entityHref(
  dim: ChangeDim,
  row: { key: string; label: string; network: string | null },
): string | null {
  switch (dim) {
    case "platform":
      // A platform has no page of its own (the old `/platforms/<key>` link
      // led nowhere) — its row is a label.
      return null;
    case "parent_campaign":
      // A campaign's address is its network + name; the key is its id.
      return row.network ? campaignPath(row.network, row.label) : "/campaigns";
    case "campaign":
      return adSetPath(row.key);
    case "creative":
      return `/library/${encodeURIComponent(row.label)}`;
  }
}

export const metadata = { title: "Analyzers · Changes" };

export default async function TrendsOverTimePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [products, angles] = await Promise.all([listProducts(), listAllAngles()]);
  // Remembered filters (D20): only the ones this page's queries apply.
  const applies = STRIP_FILTER_KEYS;
  const resolved = await resolveStripFilters(params, {
    keys: applies,
    platforms: ALL_PLATFORMS,
    productIds: products.map((p) => p.id),
    angles,
  });
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    productIds: resolved.productIds,
    platforms: resolved.platforms,
    types: resolved.types,
    angles: resolved.angles,
    includeExcluded: pickFirst(params.includeExcluded),
  });

  // Effective Excluded state: URL param wins, else the user's saved default.
  const includeExcluded = await resolveIncludeExcluded(
    pickFirst(params.includeExcluded),
  );
  const dim = changeDimSchema.parse(pickFirst(params.dim));

  const range = await resolvePreferredRange(
    pickFirst(params.from),
    pickFirst(params.to),
    defaultDateRange(TRAILING_DAYS_DEFAULT),
  );
  const from = range.from;
  const to = range.to;

  const filters: KpiFilters & { from: string; to: string } = {
    from,
    to,
    productIds: parsed.productIds,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    types: parsed.types.length > 0 ? parsed.types : undefined,
    angles: parsed.angles.length > 0 ? parsed.angles : undefined,
    includeExcluded,
  };

  const [k, breakdown] = await Promise.all([
    kpisWithDelta(filters),
    changeBreakdown(filters, dim),
  ]);

  // Assess + sort: loudest problems first, then by spend weight within a tier.
  const totalCurSpend = breakdown.rows.reduce((s, r) => s + r.cur.spend, 0);
  const rows: ChangeRadarRow[] = breakdown.rows
    .map((r) => ({
      key: r.key,
      label:
        dim === "platform"
          ? (PLATFORM_LABEL[r.key as keyof typeof PLATFORM_LABEL] ?? r.key)
          : r.label,
      sub: r.sub,
      href: entityHref(dim, r),
      share: totalCurSpend > 0 ? r.cur.spend / totalCurSpend : null,
      curSpend: r.cur.spend,
      prevSpend: r.prev.spend,
      assessment: assessChange(r.cur, r.prev),
    }))
    .sort((a, b) => {
      const t =
        CHANGE_TIER_ORDER[a.assessment.tier] -
        CHANGE_TIER_ORDER[b.assessment.tier];
      if (t !== 0) return t;
      return (
        Math.max(b.curSpend, b.prevSpend) - Math.max(a.curSpend, a.prevSpend)
      );
    });

  const count = (tier: string) =>
    rows.filter((r) => r.assessment.tier === tier).length;
  const summaryParts = [
    count("drop") > 0 &&
      `${count("drop")} big drop${count("drop") === 1 ? "" : "s"}`,
    count("watch") > 0 && `${count("watch")} to watch`,
    count("gone") > 0 && `${count("gone")} gone`,
    count("new") > 0 && `${count("new")} new`,
    count("stable") > 0 && `${count("stable")} stable`,
    count("low") > 0 && `${count("low")} below the spend floor`,
  ].filter(Boolean);

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          includeExcludedDefault={includeExcluded}
          products={products}
          angles={angles}
          defaultFrom={from}
          defaultTo={to}
          applies={applies}
          resolvedFilters={resolved}
        />
      }
    >
      <PageHeader
        eyebrow="Analyzers"
        title="Changes"
        info="Ranked worst-first vs the prior window of equal length. Tiny spenders never trigger warnings."
        rightSlot={
          <Badge
            variant="outline"
            className="h-auto max-w-full whitespace-normal rounded-md text-left text-ink-3"
          >
            vs {breakdown.prevRange.from} → {breakdown.prevRange.to}
          </Badge>
        }
      />

      {/* Account-level context — did the whole account move, or just one row? */}
      <div className="flex items-center gap-x-6 gap-y-2 flex-wrap rounded-lg border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-ink-3 text-label">
          Account overall
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-ink-2">Spend</span>
          <span className="tabular-nums text-ink">{usd(k.current.spend)}</span>
          <DeltaBadge delta={k.delta.spend} />
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-ink-2">ROAS</span>
          <span className="tabular-nums text-ink">{roas(k.current.roas)}</span>
          <DeltaBadge delta={k.delta.roas} />
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-ink-2">CPA</span>
          <span className="tabular-nums text-ink">{usd(k.current.cpa)}</span>
          <DeltaBadge delta={k.delta.cpa} inverted />
        </span>
      </div>

      {/* Breakdown selector + tier summary */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* The house "By" switch (Funnel, Dashboard) — same word, same look. */}
        <ParamSwitch
          param="dim"
          options={DIMS}
          value={dim}
          defaultValue={CHANGE_DIM_DEFAULT}
          ariaLabel="Break down by platform, campaign, ad set or creative"
        />
        {summaryParts.length > 0 && (
          <span className="text-[11px] text-ink-3">
            {summaryParts.join(" · ")}
          </span>
        )}
      </div>

      <AdDataGate>
        <ChangeRadar rows={rows} />
      </AdDataGate>
    </PageShell>
  );
}
