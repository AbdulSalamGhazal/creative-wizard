import Link from "@/components/nav/link";
import { GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Compare with `side` as side A over the shared window — the link and the rail's (2026-11-21). */
export function compareHref(
  side: { creatives: string } | { campaigns: string },
  range: { from: string; to: string },
): string {
  const p = new URLSearchParams();
  if ("creatives" in side) p.set("aCreatives", side.creatives);
  else p.set("aCampaigns", side.campaigns);
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
  /** Side A's selection: one creative (by id) or one campaign (by name). */
  side: { creatives: string } | { campaigns: string };
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
