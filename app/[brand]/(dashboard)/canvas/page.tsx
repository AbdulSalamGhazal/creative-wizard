import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange, presetLabel } from "@/lib/date-presets";
import {
  resolveFilterPrefs,
  resolveIncludeExcluded,
  resolvePreferredRange,
} from "@/db/queries/user-prefs";
import { canvasFocusName, canvasGraph } from "@/db/queries/canvas";
import { getRatingConfig } from "@/db/queries/rating";
import { listProducts } from "@/db/queries/products";
import {
  CANVAS_DEFAULT_STATUSES,
  canvasFiltersSchema,
} from "@/validators/canvas";
import { CanvasFilterBar } from "@/components/canvas/canvas-filter-bar";
import { CanvasView } from "@/components/canvas/canvas-view";
import { focusLevel, type CanvasLevel } from "@/lib/canvas";
import { AdDataGate } from "@/components/ui/no-ad-data-state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Canvas" };

type SearchParams = Record<string, string | string[] | undefined>;
const pickFirst = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

/**
 * Canvas — the campaign↔creative graph. READ-ONLY FACTS: an edge exists
 * because a creative spent inside a campaign in the range; nothing here is
 * ever edited, and every control is a viewing tool.
 */
export default async function CanvasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // The product dropdown doubles as the pref resolver's vocabulary: a
  // remembered product that was since deleted is dropped, not queried.
  const products = await listProducts();

  // REMEMBERED FILTERS (migration 0049): URL wins, else this user's saved value
  // for this brand, else the page default — the date range's rule, generalized.
  const pref = await resolveFilterPrefs(
    [
      { key: "platforms" },
      { key: "statuses" },
      { key: "productIds", allow: products.map((p) => p.id) },
      { key: "stages" },
    ],
    (key: string) => pickFirst(params[key]),
  );

  const parsed = canvasFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    platforms: pref.platforms,
    statuses: pref.statuses,
    productIds: pref.productIds,
    stages: pref.stages,
    level: pickFirst(params.level),
    focus: pickFirst(params.focus),
  });
  // The LEVEL the campaign side is drawn at: what the link says; a link that
  // names only a campaign's node (`focus=p:…`) is a campaign-level link.
  const level: CanvasLevel =
    pickFirst(params.level) === undefined && parsed.focus
      ? (focusLevel(parsed.focus.kind) ?? parsed.level)
      : parsed.level;

  // The range is resolved HERE and the one value feeds both the query and the
  // picker's label — a fresh URL runs the last 30 days, and says so.
  const [range, includeExcluded] = await Promise.all([
    resolvePreferredRange(parsed.from, parsed.to, defaultDateRange(30)),
    resolveIncludeExcluded(pickFirst(params.includeExcluded)),
  ]);

  // No `statuses` at all — URL or remembered — → the default (terminated
  // hidden). An explicit value, from either source, is taken as written.
  const statuses =
    pref.statuses === undefined ? CANVAS_DEFAULT_STATUSES : parsed.statuses;

  // The Rate config is cached per request: canvasGraph rates every pairing
  // with it, and the legend prints its default thresholds.
  const [graph, ratingConfig] = await Promise.all([canvasGraph({
    from: range.from,
    to: range.to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    statuses,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    stages: parsed.stages.length > 0 ? parsed.stages : undefined,
    includeExcluded,
    level,
  }), getRatingConfig()]);

  // `?focus=` — a shared link's inspected node. Drawn → the canvas opens on it
  // with its inspector. Not drawn (no spend in the range, hidden by a filter,
  // trimmed by the cap) → the page SAYS which one, so it needs the name the
  // graph can't give it: one brand-scoped lookup, only in that case.
  const focus = parsed.focus;
  const focusDrawn =
    focus !== null &&
    (focus.kind === "creative" ? graph.creatives : graph.campaigns).some(
      (n) => n.id === focus.nodeId,
    );
  const linkedFocus = focus
    ? {
        nodeId: focus.nodeId,
        kind: focus.kind,
        drawn: focusDrawn,
        name: focusDrawn ? null : await canvasFocusName(focus),
      }
    : null;

  return (
    <PageShell>
      <PageHeader
        title="Canvas"
      />
      <CanvasFilterBar
        resolvedFilters={pref}
        products={products}
        resolvedRange={range}
        effectiveStatuses={statuses}
        includeExcludedDefault={includeExcluded}
      />
      <AdDataGate>
        <CanvasView
          graph={graph}
          rangeLabel={presetLabel(range.from, range.to)}
          rateRules={ratingConfig.default}
          linkedFocus={linkedFocus}
        />
      </AdDataGate>
    </PageShell>
  );
}
