"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The PHONE treatment of a filter bar's secondary controls (user-approved
 * 2026-11-07, audit R-004; docs/decisions/filters.md). From `sm` up the
 * controls render inline exactly where the page puts them; below `sm` they
 * fold into ONE ⋯ menu, so a crowded bar wraps to fewer rows.
 *
 * A secondary control is a VIEW or TABLE control — sort, grid/table, currency,
 * a second split switch — never a filter (filters live in the Filters dialog)
 * and never the Excluded toggle (a data-scope switch that stays visible).
 *
 * Most bars use `PhoneOverflow` (inline + menu in one place). A bar whose
 * secondary controls sit in two slots renders `DesktopOnly` in each and ONE
 * `PhoneMoreMenu` holding all of them, so a phone never shows two ⋯ buttons.
 */
export function PhoneOverflow({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DesktopOnly>{children}</DesktopOnly>
      <PhoneMoreMenu>{children}</PhoneMoreMenu>
    </>
  );
}

/** Inline from `sm` up; absent from the layout (and the a11y tree) below it. */
export function DesktopOnly({ children }: { children: React.ReactNode }) {
  return <div className="hidden sm:contents">{children}</div>;
}

/** The ⋯ button a phone sees in place of the secondary controls. */
export function PhoneMoreMenu({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="sm:hidden"
          aria-label="More view options"
          title="More view options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      {/* Radix mounts the content only while open, so the controls exist once
          on screen at a time. */}
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="flex w-auto max-w-[calc(100vw-2rem)] flex-col items-start gap-2 p-2"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
