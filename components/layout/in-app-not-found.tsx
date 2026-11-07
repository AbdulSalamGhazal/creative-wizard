"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Where a 404 under an entity's list should send you (R-047): the list it
 * came from. Everything else goes to the Dashboard.
 */
const SEGMENTS: Array<{ prefix: string; title: string; href: string; label: string }> = [
  { prefix: "/library/", title: "This creative isn’t here", href: "/library", label: "Back to Library" },
  { prefix: "/campaigns/", title: "This campaign isn’t here", href: "/campaigns", label: "Back to Campaigns" },
];

/**
 * The 404 INSIDE the app shell (R-047, 2026-11-07): a renamed or deleted
 * creative, an old campaign URL, a mistyped name. The user keeps the sidebar,
 * the brand switcher and search instead of a bare full-screen page. A client
 * component only because `not-found.tsx` gets no params — the path picks the
 * wording and the way back.
 */
export function InAppNotFound() {
  const pathname = usePathname();
  const seg = SEGMENTS.find((s) => pathname.startsWith(s.prefix));
  return (
    <EmptyState
      size="lg"
      icon={<SearchX className="h-5 w-5" />}
      title={seg?.title ?? "Page not found"}
      hint={
        <>
          It may have been renamed or deleted.
          {/* A phone has no ⌘ key — its search is the top bar's icon. */}
          <span className="hidden md:inline">
            {" "}Press{" "}
            <kbd className="rounded-sm border border-line bg-surface-2 px-1 font-mono text-[10px]">⌘K</kbd>{" "}
            to search.
          </span>
        </>
      }
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={seg?.href ?? "/"}>{seg?.label ?? "Back to Dashboard"}</Link>
        </Button>
      }
    />
  );
}
