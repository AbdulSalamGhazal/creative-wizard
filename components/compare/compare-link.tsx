import Link from "@/components/nav/link";
import { GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";

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
}: {
  /** Side A's selection: one creative (by id) or one campaign (by name). */
  side: { creatives: string } | { campaigns: string };
  from: string;
  to: string;
}) {
  const p = new URLSearchParams();
  if ("creatives" in side) p.set("aCreatives", side.creatives);
  else p.set("aCampaigns", side.campaigns);
  p.set("from", from);
  p.set("to", to);
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`/compare?${p.toString()}`}>
        <GitCompare className="h-3.5 w-3.5" />
        Compare…
      </Link>
    </Button>
  );
}
