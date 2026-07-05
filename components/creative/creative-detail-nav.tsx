import Link from "next/link";
import { int } from "@/lib/format";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Top-of-page navigation for a creative detail view: a context-aware "back to
 * library" link plus a prev/next pager with an "X of Y total" counter. The
 * sequence mirrors whatever list the user was browsing — the same filters and
 * sort, carried through the query string — so paging here matches the Library.
 *
 * Server component: pure links, no client JS. `prevHref` / `nextHref` are null
 * at the ends of the list (rendered as disabled controls).
 */
export function CreativeDetailNav({
  position,
  total,
  prevHref,
  nextHref,
  backHref,
}: {
  /** 1-based index in the list, or null if the creative isn't in it. */
  position: number | null;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
  backHref: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to library
      </Link>

      <div className="inline-flex items-center rounded-md border border-line bg-surface">
        <Pager href={prevHref} dir="prev" />
        <span className="px-3 text-xs text-ink-2 tabular-nums border-x border-line h-8 inline-flex items-center whitespace-nowrap">
          {position !== null ? (
            <>
              <span className="text-ink font-medium">{position}</span>
              <span className="text-ink-3"> of {int(total)}</span>
            </>
          ) : (
            <span className="text-ink-3">{int(total)} total</span>
          )}
        </span>
        <Pager href={nextHref} dir="next" />
      </div>
    </div>
  );
}

function Pager({ href, dir }: { href: string | null; dir: "prev" | "next" }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  const label = dir === "prev" ? "Previous creative" : "Next creative";
  const base = "inline-flex items-center justify-center h-8 w-9 transition-colors";
  if (!href) {
    return (
      <span
        aria-disabled
        title={`No ${dir === "prev" ? "previous" : "next"} creative`}
        className={cn(base, "text-ink-3/40 cursor-not-allowed")}
      >
        <Icon className="w-4 h-4" />
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(base, "text-ink-2 hover:text-ink hover:bg-surface-2")}
    >
      <Icon className="w-4 h-4" />
    </Link>
  );
}
