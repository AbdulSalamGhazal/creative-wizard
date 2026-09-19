import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
/**
 * The Library's page header. The status strip used to live here; it moved
 * DIRECTLY ABOVE the list (2026-09) so it sits with what it describes and
 * visibly follows the filters.
 */
export function LibraryHeader({ canCreate }: { canCreate: boolean }) {
  return (
    <PageHeader
      title="Library"
      rightSlot={
        canCreate ? (
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/library/bulk">
                <Upload className="w-4 h-4" />
                Bulk import
              </Link>
            </Button>
            <Button asChild>
              <Link href="/library/new">
                <Plus className="w-4 h-4" />
                New creative
              </Link>
            </Button>
          </div>
        ) : undefined
      }
    />
  );
}
