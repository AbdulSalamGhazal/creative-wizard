import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { brandHasAdData } from "@/db/queries/creative-status";
import { auth, can } from "@/lib/auth";

/**
 * SERVER wrapper for a page's FIRST analytics table: renders the table when
 * the brand has any performance data, else the first-use state below. The
 * probe is `cache()`-deduped, so several gates on one page cost one query.
 */
export async function AdDataGate({ children }: { children: React.ReactNode }) {
  if (await brandHasAdData()) return <>{children}</>;
  const user = await auth();
  return <NoAdDataState canUpload={!!user && can(user, "upload.import")} />;
}

/**
 * FIRST USE of the ads analytics (R-003, 2026-11-07): the brand has no
 * performance records at all, so "Try a wider date range" — and its Show
 * lifetime button — would loop forever. This says where the data comes from
 * and offers the upload, or whom to ask. A first-use state on the ONE
 * `EmptyState` (its own hint + action, ui-system D24) — rendered by a page in
 * place of its first table only when `brandHasAdData()` is false.
 */
export function NoAdDataState({ canUpload }: { canUpload: boolean }) {
  return (
    <EmptyState
      size="lg"
      icon={<Upload className="h-5 w-5" />}
      title="No ad data yet"
      hint={
        canUpload
          ? "Upload a platform export to see performance."
          : "Ask an admin to upload ads data."
      }
      action={
        canUpload ? (
          <Button asChild size="sm">
            <Link href="/uploads/new">Upload ads</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
