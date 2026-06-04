import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  kpis,
  platformMix,
  spendByDatePlatform,
} from "@/db/queries/performance";
import {
  creativeDeletionSummary,
  creativeRecords,
  getCreativeByName,
  listAllTags,
  listCreatives,
} from "@/db/queries/creatives";
import { listProducts } from "@/db/queries/products";
import { listAuditEvents } from "@/db/queries/audit";
import { creativeListFiltersSchema } from "@/validators/creative";
import { CreativeDetailHeader } from "@/components/creative/creative-detail-header";
import { CreativeDetailNav } from "@/components/creative/creative-detail-nav";
import { DeleteCreativeDialog } from "@/components/creative/delete-creative-dialog";
import { CreativePerfLineChart } from "@/components/charts/creative-perf-line";
import { CreativePlatformTable } from "@/components/creative/creative-platform-table";
import { CreativeRecordsTable } from "@/components/creative/creative-records-table";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import { NotesPanel } from "@/components/creative/notes-panel";
import { AuditFeed } from "@/components/audit/audit-feed";
import { int, pct, ratio, usd } from "@/lib/format";
import { presetLabel, resolveDefaultRange } from "@/lib/date-presets";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Library filter/sort keys carried into the detail URL so the prev/next pager
// walks the same sequence the user was browsing.
const FILTER_KEYS = [
  "q",
  "productIds",
  "types",
  "statuses",
  "platforms",
  "tags",
  "sort",
  "view",
] as const;

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function buildQuery(sp: SearchParams, keys: readonly string[]): string {
  const qs = new URLSearchParams();
  for (const k of keys) {
    const first = pickFirst(sp[k]);
    if (first) qs.set(k, first);
  }
  return qs.toString();
}

export default async function CreativeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const decoded = decodeURIComponent(name);

  const fromRaw = pickFirst(sp.from);
  const toRaw = pickFirst(sp.to);
  const from = fromRaw && ISO_DATE.test(fromRaw) ? fromRaw : undefined;
  const to = toRaw && ISO_DATE.test(toRaw) ? toRaw : undefined;
  // Default to the last 7 days when no range is set (Lifetime is concrete).
  // `from`/`to` stay raw (null when unset) for the picker; `range` is resolved.
  const eff = resolveDefaultRange(from, to);
  const range = { from: eff.from, to: eff.to };
  const rangeLabel = presetLabel(eff.from, eff.to);

  // Rebuild the Library's filtered/sorted sequence so the pager matches it.
  const navParsed = creativeListFiltersSchema.parse({
    q: pickFirst(sp.q),
    productIds: pickFirst(sp.productIds),
    types: pickFirst(sp.types),
    statuses: pickFirst(sp.statuses),
    platforms: pickFirst(sp.platforms),
    tags: pickFirst(sp.tags),
    sort: pickFirst(sp.sort),
    view: pickFirst(sp.view),
  });
  const navFilters = {
    q: navParsed.q,
    productIds: navParsed.productIds.length > 0 ? navParsed.productIds : undefined,
    types: navParsed.types.length > 0 ? navParsed.types : undefined,
    statuses: navParsed.statuses.length > 0 ? navParsed.statuses : undefined,
    platforms: navParsed.platforms.length > 0 ? navParsed.platforms : undefined,
    tags: navParsed.tags.length > 0 ? navParsed.tags : undefined,
    sort: navParsed.sort,
  };

  const creative = await getCreativeByName(decoded);
  if (!creative) {
    notFound();
  }

  const [
    k,
    byPlatform,
    perfRows,
    records,
    activity,
    deletionSummary,
    allTags,
    products,
    navList,
  ] = await Promise.all([
    kpis({ creativeIds: [creative.id], ...range }),
    platformMix({ creativeIds: [creative.id], ...range }),
    spendByDatePlatform({ creativeIds: [creative.id], ...range }),
    creativeRecords(creative.id, range),
    listAuditEvents({
      entityType: "creative",
      entityId: creative.id,
      limit: 25,
    }),
    creativeDeletionSummary(creative.id),
    listAllTags(),
    listProducts(),
    // Reuse listCreatives so the pager order is byte-for-byte the Library's.
    // (Returns names + a little extra; fine at this scale — revisit with a
    // name-only query if the catalog grows into the thousands.)
    listCreatives(navFilters),
  ]);

  // ── Prev / next pager over the rebuilt sequence ──
  const seqNames = navList.rows.map((r) => r.name);
  const idx = seqNames.indexOf(decoded);
  const total = seqNames.length;
  const position = idx >= 0 ? idx + 1 : null;
  const prevName = idx > 0 ? seqNames[idx - 1] ?? null : null;
  const nextName =
    idx >= 0 && idx < seqNames.length - 1 ? seqNames[idx + 1] ?? null : null;

  const filterCtx = buildQuery(sp, FILTER_KEYS);
  const navQuery = buildQuery(sp, [...FILTER_KEYS, "from", "to"]);
  const backHref = filterCtx ? `/creatives?${filterCtx}` : "/creatives";
  const detailHref = (nm: string) =>
    `/creatives/${encodeURIComponent(nm)}${navQuery ? `?${navQuery}` : ""}`;

  const tiles = [
    { label: "Spend", value: usd(k.spend) },
    { label: "Impressions", value: int(k.impressions) },
    { label: "Blended CTR", value: pct(k.ctr) },
    { label: "Conversions", value: int(k.conversions) },
    { label: "Blended CvR", value: pct(k.cvr) },
    { label: "Blended CPA", value: usd(k.cpa) },
    { label: "Blended ROAS", value: ratio(k.roas) },
  ];

  return (
    <div className="space-y-10">
      {/* ─────────── Pager ─────────── */}
      <CreativeDetailNav
        position={position}
        total={total}
        prevHref={prevName ? detailHref(prevName) : null}
        nextHref={nextName ? detailHref(nextName) : null}
        backHref={backHref}
      />

      {/* ─────────── Information ─────────── */}
      <section className="space-y-6">
        <CreativeDetailHeader
          creative={creative}
          allTags={allTags}
          products={products}
        />
        <NotesPanel creativeId={creative.id} initialNotes={creative.notes} />
      </section>

      {/* ─────────── Analytics ─────────── */}
      <section className="space-y-8 rounded-xl border border-line bg-surface/40 p-4 md:p-6">
        <div className="flex items-end justify-between gap-3 flex-wrap border-b border-line pb-4">
          <div>
            <h2 className="font-display text-xl tracking-tight">Analytics</h2>
            <p className="text-[11px] text-ink-3 num mt-0.5">
              {rangeLabel} · across platforms
            </p>
          </div>
          <AnalyticsDateFilter from={from ?? null} to={to ?? null} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
          {tiles.map((t) => (
            <Card key={t.label} className="bg-surface border-line">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-[0.14em] text-ink-3 font-medium">
                  {t.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl num text-ink leading-none">
                  {t.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-surface border-line">
          <CardHeader>
            <CardTitle className="text-sm">Performance over time</CardTitle>
          </CardHeader>
          <CardContent>
            <CreativePerfLineChart rows={perfRows} />
          </CardContent>
        </Card>

        <div>
          <h3 className="text-sm font-medium text-ink mb-3">By platform</h3>
          <CreativePlatformTable rows={byPlatform} />
        </div>

        <div>
          <h3 className="text-sm font-medium text-ink mb-3">
            {from && to ? "Records in range" : "All records"}
          </h3>
          <CreativeRecordsTable rows={records} />
        </div>
      </section>

      {/* ─────────── Activity log ─────────── */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-medium text-ink">Activity</h2>
          <span className="text-[11px] text-ink-3">
            {activity.length === 0
              ? "No activity recorded yet."
              : `Last ${activity.length} event${activity.length === 1 ? "" : "s"} for this creative.`}
          </span>
        </div>
        <AuditFeed rows={activity} />
      </div>

      {/* ─────────── Danger zone ─────────── */}
      <div className="rounded-xl border border-neg/30 bg-neg/5 p-4 md:p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-medium text-ink">Delete this creative</h2>
            <p className="text-xs text-ink-3 mt-0.5 max-w-xl">
              Permanently removes the creative, its tags, and all{" "}
              {deletionSummary.records.toLocaleString()} of its performance
              records. This can&apos;t be undone and affects no other creative.
            </p>
          </div>
          <DeleteCreativeDialog
            creativeId={creative.id}
            creativeName={creative.name}
            summary={deletionSummary}
          />
        </div>
      </div>
    </div>
  );
}
