import { Suspense } from "react";
import { getActiveAccountId } from "@/lib/tenant";
import { requirePriceStructureAccess } from "@/lib/price-structure-access";
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
 * Any of the module's three grants opens it (view · edit · versions); each
 * page re-checks, so the sidebar's derived gate and the pages agree
 * (nav-gates.test.ts). What the member may CHANGE travels to the provider as
 * `access`, which hides or disables the controls — the actions are the gate.
 */
export default async function PriceStructureLayout({ children }: { children: React.ReactNode }) {
  const { user: me, access } = await requirePriceStructureAccess();
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
      <VersionProvider initialRows={rows} lastOpenedId={lastOpenedId} access={access}>
        {children}
      </VersionProvider>
    </Suspense>
  );
}
