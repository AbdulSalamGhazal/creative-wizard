"use client";

import { useState } from "react";
import Link from "next/link";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { LandingPagesTable } from "@/components/trends/landing-pages-table";
import { LandingPagesChart } from "@/components/trends/landing-pages-chart";
import type {
  LandingPageDailyRow,
  LandingPageRollupRow,
} from "@/db/queries/landing-page-performance";

type Mode = "page" | "platform";

/**
 * Trends → LPs, the client surface: the row-mode control (a VIEW switch,
 * client state — never a filter), the table in that mode, then the chart.
 * Both rollups arrive with the page so switching is instant and costs no
 * render; the chart always reads per page, whichever mode the table is in.
 */
export function LandingPagesView({
  byPage,
  byPlatform,
  daily,
  from,
  to,
  landingPagesRegistered,
}: {
  byPage: LandingPageRollupRow[];
  byPlatform: LandingPageRollupRow[];
  daily: LandingPageDailyRow[];
  from: string;
  to: string;
  /** Whether the brand has registered any landing page at all. */
  landingPagesRegistered: boolean;
}) {
  const [mode, setMode] = useState<Mode>("page");
  const rows = mode === "page" ? byPage : byPlatform;

  // First use: nothing can be split by landing page until one is registered
  // and an ad carries its @code. Say so where the pages would be.
  const firstUse = !landingPagesRegistered;

  return (
    <>
      <div className="space-y-2">
        <SegmentedControl
          ariaLabel="Rows"
          value={mode}
          onChange={setMode}
          options={[
            { value: "page", label: "By page" },
            { value: "platform", label: "By page · platform" },
          ]}
        />
        <LandingPagesTable
          rows={rows}
          empty={
            firstUse ? (
              <EmptyState
                title="No landing pages yet."
                hint="Register a landing page on the Library's Landing pages tab, then end an ad's name with its @code. Its performance lands here beside the product page."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/library?tab=landing-pages">Landing pages</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState title="No performance in this window." kind="filtered" />
            )
          }
        />
        {firstUse && rows.length > 0 && (
          <p className="text-[11px] text-ink-3">
            Only the product page so far —{" "}
            <Link href="/library?tab=landing-pages" className="text-ink-2 underline-offset-2 hover:underline">
              register a landing page
            </Link>{" "}
            and end an ad&apos;s name with its @code to split it out.
          </p>
        )}
      </div>

      <LandingPagesChart daily={daily} pages={byPage} from={from} to={to} />
    </>
  );
}
