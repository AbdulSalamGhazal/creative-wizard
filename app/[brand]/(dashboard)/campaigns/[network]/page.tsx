import { brandPermanentRedirect } from "@/lib/brand-redirect";
import { adSetPath } from "@/lib/campaign";
import { safeDecodeURIComponent } from "@/lib/url";

/**
 * A SINGLE segment under /campaigns was an AD SET's page until 2026-11,
 * addressed by its stored name; ad sets now live under /ad-sets, and a
 * campaign's own page takes TWO segments (network, then name). So one segment
 * here is always an OLD ad-set link — a bookmark, a link in a chat: permanent
 * redirect, the name and every param (range, Excluded) preserved. An address
 * that names no ad set 404s there, under "Ad sets".
 *
 * (The folder is `[network]` because Next allows one slug name per level and
 * the campaign page below needs it; here the segment is the old ad-set name.
 * No angle brackets in this comment: `app/routes.test.ts` reads a redirect
 * stub as "redirects and renders no JSX", lexically.)
 */
export default async function LegacyAdSetRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ network: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { network: legacyName } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else if (value !== undefined) qs.set(key, value);
  }
  const query = qs.toString();
  const target = adSetPath(safeDecodeURIComponent(legacyName));
  return brandPermanentRedirect(query ? `${target}?${query}` : target);
}
