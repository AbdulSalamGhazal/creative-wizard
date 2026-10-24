import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { auth, can } from "@/lib/auth";
import { getCreativeByName, listAllAngles } from "@/db/queries/creatives";
import { listProducts } from "@/db/queries/products";
import {
  creativeStatusMap,
  statusFor,
  terminatedPlatformsFor,
} from "@/db/queries/creative-status";
import { creativeListFiltersSchema } from "@/validators/creative";
import { CreativeDetailHeader } from "@/components/creative/creative-detail-header";
import {
  CreativeAnalyticsBody,
  CreativePager,
  CreativeRecordsActivity,
} from "@/components/creative/creative-detail-sections";
import {
  AnalyticsBodySkeleton,
  PagerSkeleton,
  RecordsActivitySkeleton,
} from "@/components/creative/creative-detail-skeletons";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import { NotesPanel } from "@/components/creative/notes-panel";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";
import { PageShell } from "@/components/layout/page-shell";
import { defaultDateRange, presetLabel } from "@/lib/date-presets";
import { resolvePreferredRange, resolveIncludeExcluded } from "@/db/queries/user-prefs";
import { safeDecodeURIComponent } from "@/lib/url";
import { ExcludedParamToggle } from "@/components/filters/excluded-param-toggle";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Library filter/sort keys carried into the detail URL so the prev/next pager
// walks the same sequence the user was browsing.
const FILTER_KEYS = [
  "q",
  "productIds",
  "types",
  "statuses",
  "priorities",
  "stages",
  "platforms",
  "angles",
  "sort",
  "view",
  "includeExcluded",
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

/**
 * Tab title: "Creative · <name> · Wizard". `getCreativeByName` is cache()-wrapped,
 * so this shares the page's fetch rather than querying twice. An unknown creative
 * falls back to the section name (the page 404s anyway).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const creative = await getCreativeByName(safeDecodeURIComponent(name));
  return { title: creative ? `Creative · ${creative.name}` : "Library" };
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
  const decoded = safeDecodeURIComponent(name);

  const fromRaw = pickFirst(sp.from);
  const toRaw = pickFirst(sp.to);
  const from = fromRaw && ISO_DATE.test(fromRaw) ? fromRaw : undefined;
  const to = toRaw && ISO_DATE.test(toRaw) ? toRaw : undefined;
  // Default to the last 7 days when no range is set (Lifetime is concrete).
  // `from`/`to` stay raw (null when unset) for the picker; `range` is resolved.
  const eff = await resolvePreferredRange(from, to, defaultDateRange());
  const range = { from: eff.from, to: eff.to };
  const rangeLabel = presetLabel(eff.from, eff.to);
  // Effective Excluded state for the analytics aggregates (records table below
  // always shows every row, badge included — this only governs aggregates).
  const inc = await resolveIncludeExcluded(pickFirst(sp.includeExcluded));

  // Rebuild the Library's filtered/sorted sequence so the pager matches it.
  const navParsed = creativeListFiltersSchema.parse({
    q: pickFirst(sp.q),
    productIds: pickFirst(sp.productIds),
    types: pickFirst(sp.types),
    statuses: pickFirst(sp.statuses),
    priorities: pickFirst(sp.priorities),
    stages: pickFirst(sp.stages),
    platforms: pickFirst(sp.platforms),
    angles: pickFirst(sp.angles),
    sort: pickFirst(sp.sort),
    view: pickFirst(sp.view),
  });
  // Every filter the Library carries into the link — priority, stage and the
  // Excluded state (which moves the 7d/30d spend a spend sort reads) included,
  // or the pager would walk a different sequence than the one on screen.
  const navFilters = {
    q: navParsed.q,
    productIds: navParsed.productIds.length > 0 ? navParsed.productIds : undefined,
    types: navParsed.types.length > 0 ? navParsed.types : undefined,
    statuses: navParsed.statuses.length > 0 ? navParsed.statuses : undefined,
    priorities: navParsed.priorities.length > 0 ? navParsed.priorities : undefined,
    stages: navParsed.stages.length > 0 ? navParsed.stages : undefined,
    platforms: navParsed.platforms.length > 0 ? navParsed.platforms : undefined,
    angles: navParsed.angles.length > 0 ? navParsed.angles : undefined,
    sort: navParsed.sort,
    includeExcluded: pickFirst(sp.includeExcluded) === "1",
  };

  const creative = await getCreativeByName(decoded);
  if (!creative) {
    notFound();
  }

  const user = await auth();
  const canDelete = user ? can(user, "creative.delete") : false;

  // What the editable header needs — and ONLY that, so it renders first (D11).
  // Dynamic status (general + per-platform) + the manual termination set,
  // both account-scoped; the header renders the general badge, the
  // per-platform rows and the Terminate / Reactivate levers from these.
  const [sMap, terminated, allAngles, products] = await Promise.all([
    creativeStatusMap([creative.id]),
    terminatedPlatformsFor(creative.id),
    listAllAngles(),
    listProducts(),
  ]);
  const status = statusFor(sMap, creative.id);

  const filterCtx = buildQuery(sp, FILTER_KEYS);
  const navQuery = buildQuery(sp, [...FILTER_KEYS, "from", "to"]);
  const backHref = filterCtx ? `/library?${filterCtx}` : "/library";

  return (
    <PageShell>
      {/* The comment drawer follows this creative, not the page it sits on. */}
      <CommentAnchor type="creative" id={creative.id} />

      {/* ─────────── Pager (streamed) ─────────── */}
      <Suspense fallback={<PagerSkeleton backHref={backHref} />}>
        <CreativePager
          name={decoded}
          filters={navFilters}
          navQuery={navQuery}
          backHref={backHref}
        />
      </Suspense>

      {/* ─────────── Information ─────────── */}
      <section className="space-y-6">
        <CreativeDetailHeader
          creative={creative}
          status={status}
          terminated={terminated}
          allAngles={allAngles}
          products={products}
        />
        <NotesPanel creativeId={creative.id} initialNotes={creative.notes} />
      </section>

      {/* ─────────── Analytics (body streamed) ─────────── */}
      <section className="space-y-8 rounded-xl border border-line bg-surface/40 p-4 md:p-6">
        <div className="flex items-end justify-between gap-3 flex-wrap border-b border-line pb-4">
          <div>
            <h2 className="font-display text-xl tracking-tight">Analytics</h2>
            <p className="text-[11px] text-ink-3 num mt-0.5">
              {rangeLabel} · across platforms
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExcludedParamToggle on={inc} />
            <AnalyticsDateFilter
              from={from ?? null}
              to={to ?? null}
              defaultFrom={eff.from}
              defaultTo={eff.to}
            />
          </div>
        </div>

        <Suspense fallback={<AnalyticsBodySkeleton />}>
          <CreativeAnalyticsBody creativeId={creative.id} range={range} includeExcluded={inc} />
        </Suspense>
      </section>

      {/* ─────────── Records · Activity · Danger zone (streamed) ─────────── */}
      <Suspense fallback={<RecordsActivitySkeleton />}>
        <CreativeRecordsActivity
          creativeId={creative.id}
          creativeName={creative.name}
          range={range}
          recordsTitle={from && to ? "Records in range" : "All records"}
          canDelete={canDelete}
        />
      </Suspense>
    </PageShell>
  );
}
