"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { int } from "@/lib/format";

/**
 * The ONE pager (R-096): "from–to of total" and Prev · Page n / N · Next,
 * in a `<nav aria-label="Pagination">` with the buttons named "Previous page"
 * / "Next page", tabular figures, and a bigger touch target on a phone. The
 * caller owns HOW a page is reached (a navigation, a param write) through
 * `onPage`. Renders nothing when everything fits on one page.
 */
export function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1 text-xs text-ink-2"
    >
      <span className="tabular-nums whitespace-nowrap">
        {from}–{to} of {int(total)}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="max-sm:h-8 max-sm:px-3"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </Button>
        <span className="tabular-nums whitespace-nowrap" aria-current="page">
          Page {page} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="max-sm:h-8 max-sm:px-3"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </nav>
  );
}
