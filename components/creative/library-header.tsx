import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreativeStatusBreakdown } from "@/db/queries/creative-status";
import { CreativeStatusSummary } from "@/components/creative/creative-status-summary";

export function LibraryHeader({
  breakdown,
}: {
  breakdown: CreativeStatusBreakdown;
}) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Library
        </div>
        <h1 className="font-display text-4xl tracking-tight">
          All creatives, on file
        </h1>
        <CreativeStatusSummary breakdown={breakdown} />
      </div>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline">
          <Link href="/creatives/bulk">
            <Upload className="w-4 h-4" />
            Bulk import
          </Link>
        </Button>
        <Button asChild>
          <Link href="/creatives/new">
            <Plus className="w-4 h-4" />
            New creative
          </Link>
        </Button>
      </div>
    </div>
  );
}
