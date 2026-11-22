import Link from "@/components/nav/link";
import { GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Compare with `side` as side A over the shared window — the link and the rail's (2026-11-21). */
export type CompareEntity =
  | { creatives: string }
  | { campaigns: string }
  | { landingPages: string };

export function compareHref(
  side: CompareEntity,
  range: { from: string; to: string },
): string {
  const p = new URLSearchParams();
  if ("creatives" in side) p.set("aCreatives", side.creatives);
  else if ("campaigns" in side) p.set("aCampaigns", side.campaigns);
  else p.set("aLandingPages", side.landingPages);
  p.set("from", range.from);
  p.set("to", range.to);
  return `/compare?${p.toString()}`;
}

/**
 * "Compare…" — a contextual way INTO Compare (R-045, 2026-11-07): side A is
 * pre-filled with what this page is about, the shared window is this page's
 * range, and the user picks side B there. Compare is URL-driven per side, so
 * the link is the whole integration.
 */
export function CompareLink({
  side,
  from,
  to,
  className,
}: {
  /** Side A's selection: one creative (by id), one campaign (by name) or
   *  one landing page (by id). */
  side: CompareEntity;
  from: string;
  to: string;
  className?: string;
}) {
  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <Link href={compareHref(side, { from, to })}>
        <GitCompare className="h-3.5 w-3.5" />
        Compare…
      </Link>
    </Button>
  );
}
