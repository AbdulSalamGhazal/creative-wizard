import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange } from "@/lib/date-presets";
import {
  resolveIncludeExcluded,
  resolvePreferredRange,
  resolveStripFilters,
} from "@/db/queries/user-prefs";
import {
  landingPageDaily,
  landingPageRollup,
} from "@/db/queries/landing-page-performance";
import { listLandingPages } from "@/db/queries/landing-pages";
import { listProducts } from "@/db/queries/products";
import { listAllAngles } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { LandingPagesView } from "@/components/trends/landing-pages-view";
import { dashboardFiltersSchema } from "@/validators/filters";
import { PLATFORMS_WITH_CREATIVES } from "@/lib/palette";
import { PRODUCT_PAGE_LABEL } from "@/lib/landing-code";
import { pickFirst } from "@/lib/url";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;
export const metadata = { title: "Trends · LPs" };

/**
 * Trends → LPs: ad performance by the landing page an ad sent traffic to.
 * The ` @code` on an ad name picks a registered landing page at upload time;
 * every other ad reports under the product's own page, a row of its own.
 * Range, Excluded and the strip's filters resolve SERVER-side like every
 * Trends child; google is out of scope, like its siblings (user decision).
 */
export default async function TrendsLandingPagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [products, angles, registered] = await Promise.all([
    listProducts(),
    listAllAngles(),
    listLandingPages(),
  ]);
  // Remembered filters (D20): only the ones this page's queries apply.
  const applies = ["platforms", "productIds"] as const;
  const resolved = await resolveStripFilters(params, {
    keys: applies,
    platforms: PLATFORMS_WITH_CREATIVES,
    productIds: products.map((p) => p.id),
    angles,
  });
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    productIds: resolved.productIds,
    platforms: resolved.platforms,
    includeExcluded: pickFirst(params.includeExcluded),
  });

  // Effective Excluded state: URL param wins, else the user's saved default.
  const includeExcluded = await resolveIncludeExcluded(pickFirst(params.includeExcluded));

  // URL → the user's saved range (shared across the app) → the last 30 days.
  const range = await resolvePreferredRange(
    pickFirst(params.from),
    pickFirst(params.to),
    defaultDateRange(TRAILING_DAYS_DEFAULT),
  );
  const filters = {
    from: range.from,
    to: range.to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    includeExcluded,
  };

  const [byPage, byPlatform, daily] = await Promise.all([
    landingPageRollup(filters),
    landingPageRollup(filters, { byPlatform: true }),
    landingPageDaily(filters),
  ]);

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          includeExcludedDefault={includeExcluded}
          products={products}
          angles={angles}
          defaultFrom={range.from}
          defaultTo={range.to}
          applies={applies}
          resolvedFilters={resolved}
          platformScope="creative"
        />
      }
    >
      <PageHeader
        eyebrow="Trends"
        title="LPs"
        info={`An ad whose name ends in @code sends its traffic to that registered landing page. Every other ad goes to the product's own page — the ${PRODUCT_PAGE_LABEL} row. Google is not included.`}
        rightSlot={
          <Badge variant="outline" className="text-ink-3">
            {range.from} → {range.to}
          </Badge>
        }
      />

      <LandingPagesView
        byPage={byPage}
        byPlatform={byPlatform}
        daily={daily}
        from={range.from}
        to={range.to}
        landingPagesRegistered={registered.length > 0}
      />
    </PageShell>
  );
}
