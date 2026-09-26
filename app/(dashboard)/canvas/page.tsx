import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange, presetLabel } from "@/lib/date-presets";
import {
  resolveFilterPrefs,
  resolveIncludeExcluded,
  resolvePreferredRange,
} from "@/db/queries/user-prefs";
import { canvasGraph } from "@/db/queries/canvas";
import { listProducts } from "@/db/queries/products";
import {
  CANVAS_DEFAULT_STATUSES,
  canvasFiltersSchema,
} from "@/validators/canvas";
import { CanvasFilterBar } from "@/components/canvas/canvas-filter-bar";
import { CanvasView } from "@/components/canvas/canvas-view";

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
  });

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

  const graph = await canvasGraph({
    from: range.from,
    to: range.to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    statuses,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    stages: parsed.stages.length > 0 ? parsed.stages : undefined,
    includeExcluded,
  });

  return (
    <PageShell>
      <PageHeader
        title="Canvas"
        subtitle="Which creatives run in which campaigns — a line wherever one spent inside the other in this range. Click to focus, double-click to open."
      />
      <CanvasFilterBar
        resolvedFilters={pref}
        products={products}
        resolvedRange={range}
        effectiveStatuses={statuses}
        includeExcludedDefault={includeExcluded}
      />
      <CanvasView graph={graph} rangeLabel={presetLabel(range.from, range.to)} />
    </PageShell>
  );
}
