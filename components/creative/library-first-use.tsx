import Link from "next/link";
import { Images, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The Library when the BRAND has no creatives at all (R-018, 2026-11-07) —
 * a new brand, or a member's first visit. "No creatives match these filters"
 * was false there (no filter is on) and a dead end (Clear had nothing to
 * clear). Both views render this; the actions are the header's own two,
 * gated the same way (`creative.create`).
 */
export function LibraryFirstUse({ canCreate }: { canCreate: boolean }) {
  return (
    <EmptyState
      size="lg"
      icon={<Images className="h-5 w-5" />}
      title="No creatives yet"
      hint={
        canCreate ? "Add one, or import a sheet of them." : "Ask an admin to add creatives."
      }
      action={
        canCreate ? (
          <>
            <Button asChild size="sm">
              <Link href="/library/new">
                <Plus className="h-3.5 w-3.5" />
                New creative
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/library/bulk">
                <Upload className="h-3.5 w-3.5" />
                Bulk import
              </Link>
            </Button>
          </>
        ) : undefined
      }
    />
  );
}
