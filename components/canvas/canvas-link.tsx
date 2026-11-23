import Link from "@/components/nav/link";
import { Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canvasFocusHref } from "@/lib/canvas";

/**
 * "On the Canvas" — the way INTO the Canvas from a creative's or campaign's
 * own page (2026-11-20): the Canvas opens focused on it, inspector open, over
 * this page's range. Sits beside "Compare…", the same kind of link — the
 * sidebar's Canvas icon so the destination reads at a glance.
 */
export function CanvasLink({
  entity,
  from,
  to,
  className,
}: {
  entity: { campaignId: string } | { parentCampaignId: string } | { creativeId: string };
  from: string;
  to: string;
  className?: string;
}) {
  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <Link href={canvasFocusHref(entity, { from, to })}>
        <Workflow className="h-3.5 w-3.5" />
        On the Canvas
      </Link>
    </Button>
  );
}
