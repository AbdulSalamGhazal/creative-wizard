import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { auth, can } from "@/lib/auth";
import { getLandingPageByCode } from "@/db/queries/landing-pages";
import { listProducts } from "@/db/queries/products";
import { resolvePreferredRange, resolveIncludeExcluded } from "@/db/queries/user-prefs";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";
import { AnalyticsDateFilter } from "@/components/creative/analytics-date-filter";
import { LandingPageBodySkeleton } from "@/components/landing-page/landing-page-detail-skeleton";
import { ExcludedParamToggle } from "@/components/filters/excluded-param-toggle";
import { Chip } from "@/components/ui/chip";
import { LandingPageEditButton } from "@/components/landing-page/landing-page-edit-button";
import { LandingPageAnalyticsBody } from "@/components/landing-page/landing-page-detail-sections";
import { defaultDateRange } from "@/lib/date-presets";
import { int } from "@/lib/format";
import { pickFirst, safeDecodeURIComponent } from "@/lib/url";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The link as a person reads it: no scheme, no trailing slash. */
const shortUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/**
 * Tab title: "Landing page · <name>". `getLandingPageByCode` is cache()-wrapped,
 * so this shares the page's fetch. An unknown code falls back to the Library
 * (the page 404s anyway).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const page = await getLandingPageByCode(safeDecodeURIComponent(code));
  return { title: page ? `Landing page · ${page.name}` : "Library" };
}

/**
 * A landing page's own page (2026-11-12): what the ads carrying its ` @code`
 * did — the creative page's analytics (tiles, chart by platform, campaigns /
 * platforms), plus the creatives that sent the traffic. Addressed by CODE
 * (unique per brand, locked once records use it). Comments and Activity
 * follow the page (`landing_page` anchor).
 */
export default async function LandingPageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const sp = await searchParams;

  const page = await getLandingPageByCode(safeDecodeURIComponent(code));
  if (!page) notFound();

  const fromRaw = pickFirst(sp.from);
  const toRaw = pickFirst(sp.to);
  const from = fromRaw && ISO_DATE.test(fromRaw) ? fromRaw : undefined;
  const to = toRaw && ISO_DATE.test(toRaw) ? toRaw : undefined;
  const eff = await resolvePreferredRange(from, to, defaultDateRange());
  const range = { from: eff.from, to: eff.to };
  const inc = await resolveIncludeExcluded(pickFirst(sp.includeExcluded));

  const user = await auth();
  const canManage = user ? can(user, "catalog.landing_pages") : false;
  // The edit dialog's Product picker — only fetched for someone who can edit.
  const products = canManage ? await listProducts() : [];

  return (
    <PageShell>
      {/* The comment drawer follows this landing page, not the route. */}
      <CommentAnchor type="landing_page" id={page.id} />

      <PageHeader
        backLink={{ href: "/library?tab=landing-pages", label: "Back to Landing pages" }}
        eyebrow={page.productName ?? "Landing page"}
        title={page.name}
        clampTitle
        rightSlot={
          canManage ? <LandingPageEditButton row={page} products={products} /> : undefined
        }
      >
        {/* One muted meta line (R-065): code · link · usage. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
          <Chip className="font-mono">@{page.code}</Chip>
          <span aria-hidden className="text-ink-3">·</span>
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 max-w-[16rem] items-center gap-1 hover:text-ink sm:max-w-[28rem]"
            title={page.url}
          >
            <span className="truncate">{shortUrl(page.url)}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
          </a>
          <span aria-hidden className="text-ink-3">·</span>
          <span className="tabular-nums">
            {int(page.creatives)} creative{page.creatives === 1 ? "" : "s"}
          </span>
        </div>
        {page.description && (
          <p className="mt-1.5 max-w-2xl text-xs text-ink-2" dir="auto">
            {page.description}
          </p>
        )}
      </PageHeader>

      {/* ─────────── Analytics (body streamed) — the creative page's
          section: heading row with its controls, no frame of its own. ─────────── */}
      <section className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap border-b border-line pb-3">
          <h2 className="text-label text-ink-3">Analytics</h2>
          <div className="flex flex-wrap items-center gap-2">
            <ExcludedParamToggle on={inc} />
            <AnalyticsDateFilter
              from={from ?? null}
              to={to ?? null}
              defaultFrom={eff.from}
              defaultTo={eff.to}
            />
          </div>
        </div>

        <Suspense fallback={<LandingPageBodySkeleton />}>
          <LandingPageAnalyticsBody
            landingPageId={page.id}
            range={range}
            includeExcluded={inc}
          />
        </Suspense>
      </section>
    </PageShell>
  );
}
