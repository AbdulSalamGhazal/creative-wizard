"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExcludedToggle } from "@/components/filters/filter-pill";
import { useNavTransition } from "@/lib/nav-progress";
import { setIncludeExcludedPref } from "@/app/actions/user-prefs";

/**
 * Standalone Excluded toggle for pages without a big filter bar (detail pages,
 * Compare, Reconciliation, Library). `on` is the EFFECTIVE state the server
 * resolved (URL param → saved preference → hidden). Toggling writes an explicit
 * `includeExcluded=1|0` URL param (so the URL always wins from here on) AND
 * persists the choice as the user's default via `setIncludeExcludedPref` —
 * the same dual-write the filter bars do.
 */
export function ExcludedParamToggle({
  on,
  fullWidth,
}: {
  on: boolean;
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();

  const toggle = () => {
    const next = !on;
    void setIncludeExcludedPref(next); // best-effort persistence
    const params = new URLSearchParams(searchParams.toString());
    params.set("includeExcluded", next ? "1" : "0");
    params.delete("page");
    startNav(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  return <ExcludedToggle on={on} onToggle={toggle} fullWidth={fullWidth} />;
}
