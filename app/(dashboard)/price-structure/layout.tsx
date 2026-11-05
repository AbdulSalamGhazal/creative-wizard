import { Suspense } from "react";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { PRICE_STRUCTURE_GATE } from "@/lib/page-gates";
import { getLastVersionId, listVersions } from "@/db/queries/price-structure";
import { VersionProvider } from "@/components/price-structure/version-provider";
import { HeaderSkeleton } from "@/components/layout/page-skeletons";

export const dynamic = "force-dynamic";

/**
 * The Price Structure module's shell — the ONE nested layout in the app
 * (2026-11). It holds the client `VersionProvider`, so the open version, the
 * edits not yet saved and the autosave timer survive a switch between the
 * module's pages (sibling navigations never re-render a layout). The brand's
 * versions are read once here — a few KB each — because the picker needs them
 * all and the Versions page summarises every one from its data.
 *
 * One permission opens the whole module; each page re-checks it as well, so
 * the sidebar's derived gate and the pages agree (nav-gates.test.ts).
 */
export default async function PriceStructureLayout({ children }: { children: React.ReactNode }) {
  const me = await requirePermission(PRICE_STRUCTURE_GATE);
  const acct = await getActiveAccountId();
  const [rows, lastOpenedId] = await Promise.all([listVersions(acct), getLastVersionId(me.id, acct)]);
  return (
    // The provider reads `?v=` with useSearchParams.
    <Suspense
      fallback={
        <div className="space-y-6">
          <HeaderSkeleton eyebrow right />
        </div>
      }
    >
      <VersionProvider initialRows={rows} lastOpenedId={lastOpenedId}>
        {children}
      </VersionProvider>
    </Suspense>
  );
}
