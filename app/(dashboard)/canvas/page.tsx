import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange, presetLabel } from "@/lib/date-presets";
import {
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
  const parsed = canvasFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    platforms: pickFirst(params.platforms),
    statuses: pickFirst(params.statuses),
    productIds: pickFirst(params.productIds),
    stages: pickFirst(params.stages),
  });

  // The range is resolved HERE and the one value feeds both the query and the
  // picker's label — a fresh URL runs the last 30 days, and says so.
  const [range, includeExcluded, products] = await Promise.all([
    resolvePreferredRange(parsed.from, parsed.to, defaultDateRange(30)),
    resolveIncludeExcluded(pickFirst(params.includeExcluded)),
    listProducts(),
  ]);

  // No `statuses` param → the default (terminated hidden). An explicit param
  // is taken as written.
  const statuses =
    pickFirst(params.statuses) === undefined
      ? CANVAS_DEFAULT_STATUSES
      : parsed.statuses;

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
        products={products}
        resolvedRange={range}
        effectiveStatuses={statuses}
        includeExcludedDefault={includeExcluded}
      />
      <CanvasView graph={graph} rangeLabel={presetLabel(range.from, range.to)} />
    </PageShell>
  );
}
