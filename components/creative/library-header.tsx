import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import type { CreativeStatusBreakdown } from "@/db/queries/creative-status";
import { CreativeStatusSummary } from "@/components/creative/creative-status-summary";

export function LibraryHeader({
  breakdown,
  canCreate,
}: {
  breakdown: CreativeStatusBreakdown;
  canCreate: boolean;
}) {
  return (
    <PageHeader
      eyebrow="Library"
      title="Creatives"
      rightSlot={
        canCreate ? (
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
        ) : undefined
      }
    >
      <CreativeStatusSummary breakdown={breakdown} />
    </PageHeader>
  );
}
