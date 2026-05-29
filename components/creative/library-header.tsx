import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreativeStats } from "@/db/queries/creatives";

export function LibraryHeader({ stats }: { stats: CreativeStats }) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Library
        </div>
        <h1 className="font-display text-4xl tracking-tight">
          All creatives, on file
        </h1>
        <div className="mt-2 flex items-center gap-2 text-sm text-ink-2 num">
          <span>{stats.total} total</span>
          <span className="text-ink-3">·</span>
          <span className="text-pos">{stats.active} active</span>
          <span className="text-ink-3">·</span>
          <span className="text-warn">{stats.paused} paused</span>
          <span className="text-ink-3">·</span>
          <span>{stats.addedThisMonth} this month</span>
        </div>
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
