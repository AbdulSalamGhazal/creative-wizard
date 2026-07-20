import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  changeBreakdown,
  kpisWithDelta,
  type ChangeDim,
  type KpiFilters,
} from "@/db/queries/performance";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import {
  ChangeRadar,
  type ChangeRadarRow,
} from "@/components/trends/change-radar";
import { assessChange, CHANGE_TIER_ORDER } from "@/lib/change-radar";
import { changeDimSchema, dashboardFiltersSchema } from "@/validators/filters";
import { PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { usd, roas } from "@/lib/format";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

const DIMS: Array<{ value: ChangeDim; label: string }> = [
  { value: "platform", label: "Platform" },
  { value: "campaign", label: "Campaign" },
  { value: "creative", label: "Creative" },
];

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function entityHref(dim: ChangeDim, key: string, label: string): string {
  switch (dim) {
    case "platform":
      return `/platforms/${key}`;
    case "campaign":
      return `/campaigns/${encodeURIComponent(key)}`;
    case "creative":
      return `/creatives/${encodeURIComponent(label)}`;
  }
}

export const metadata = { title: "Trends · Changes" };

export default async function TrendsOverTimePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    productIds: pickFirst(params.productIds),
    platforms: pickFirst(params.platforms),
    types: pickFirst(params.types),
    tags: pickFirst(params.tags),
    includeExcluded: pickFirst(params.includeExcluded),
  });
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
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const [k, breakdown, products, tags] = await Promise.all([
    kpisWithDelta(filters),
    changeBreakdown(filters, dim),
    listProducts(),
    listAllTags(),
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
      href: entityHref(dim, r.key, r.label),
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

  // Dim switcher links preserve every other filter param.
  const dimHref = (d: ChangeDim) => {
    const next = new URLSearchParams();
    for (const [key, v] of Object.entries(params)) {
      const val = pickFirst(v);
      if (val && key !== "dim") next.set(key, val);
    }
    if (d !== "campaign") next.set("dim", d);
    const qs = next.toString();
    return qs ? `/trends/over-time?${qs}` : "/trends/over-time";
  };

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          products={products}
          tags={tags}
          defaultFrom={from}
          defaultTo={to}
        />
      }
    >
      <PageHeader
        backLink={{ href: "/trends", label: "Trends" }}
        title="Changes"
        subtitle={
          <>
            Ranked worst-first vs the prior window of equal length. Tiny
            spenders never trigger warnings.
          </>
        }
        rightSlot={
          <Badge variant="outline" className="text-ink-3">
            {from} → {to} · vs {breakdown.prevRange.from} →{" "}
            {breakdown.prevRange.to}
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
          <span className="num text-ink">{usd(k.current.spend)}</span>
          <DeltaBadge delta={k.delta.spend} />
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-ink-2">ROAS</span>
          <span className="num text-ink">{roas(k.current.roas)}</span>
          <DeltaBadge delta={k.delta.roas} />
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-ink-2">CPA</span>
          <span className="num text-ink">{usd(k.current.cpa)}</span>
          <DeltaBadge delta={k.delta.cpa} inverted />
        </span>
      </div>

      {/* Breakdown selector + tier summary */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex rounded-md border border-line overflow-hidden text-xs">
          {DIMS.map((d) => (
            <Link
              key={d.value}
              href={dimHref(d.value)}
              scroll={false}
              className={cn(
                "px-3 h-8 inline-flex items-center transition-colors",
                d.value === dim
                  ? "bg-[var(--brand-soft)] text-ink"
                  : "text-ink-2 hover:text-ink hover:bg-surface-2",
              )}
            >
              {d.label}
            </Link>
          ))}
        </div>
        {summaryParts.length > 0 && (
          <span className="text-[11px] text-ink-3">
            {summaryParts.join(" · ")}
          </span>
        )}
      </div>

      <ChangeRadar rows={rows} />
    </PageShell>
  );
}
