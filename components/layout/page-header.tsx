import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/info-tip";

interface PageHeaderProps {
  /** Small uppercase kicker above the title (e.g. "Admin"). */
  eyebrow?: string;
  /** Back link rendered above the title. One canonical size everywhere. */
  backLink?: { href: string; label: string };
  title: string;
  /**
   * ONE short line under the title — a count, a range: a FACT. Never helper
   * prose (D25, "Show, don't label"): a page's purpose is its title, and a
   * note that states a standing rule goes in `info`.
   */
  subtitle?: ReactNode;
  /**
   * A standing rule of this page ("Actuals are raw totals", "Counts only — no
   * revenue comparison"), as an ⓘ beside the title — keyboard-reachable,
   * read on demand, never body copy the eye must read past (D25).
   */
  info?: ReactNode;
  /** What a screen reader hears on the ⓘ (default "About this page"). */
  infoLabel?: string;
  /** Rich block rendered in the title column, below the subtitle (e.g. a
   *  status summary). For prose use `subtitle`; use this for elements. */
  children?: ReactNode;
  /** Right-aligned slot — a primary action button or a context badge. */
  rightSlot?: ReactNode;
  /**
   * An ENTITY's name as the title (campaign / creative detail): clamp it to two
   * lines with the full name as its tooltip, so an 80-character name can't
   * fill a phone's first screen (R-030).
   */
  clampTitle?: boolean;
}

/**
 * The single page-title header for every route. Replaces the hand-rolled
 * eyebrow / back-link / title / subtitle blocks that had drifted (two back-link
 * sizes, eyebrow on half the pages, ink-2 vs ink-3 subtitles). Keep new pages
 * on this — don't re-roll a header.
 */
export function PageHeader({
  eyebrow,
  backLink,
  title,
  subtitle,
  info,
  infoLabel = "About this page",
  children,
  rightSlot,
  clampTitle = false,
}: PageHeaderProps) {
  // The title follows the frame (R-030, 2026-11): 36px display type is right
  // for "Dashboard" on a desktop, not for a 327px phone column.
  const h1 = (
    <h1
      className={
        "font-display text-2xl sm:text-3xl lg:text-4xl tracking-tight break-words" +
        (clampTitle ? " line-clamp-2" : "")
      }
      title={clampTitle ? title : undefined}
      // A name may be Arabic, or Arabic mixed with Latin and digits (R-040).
      dir="auto"
    >
      {title}
    </h1>
  );
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div className="min-w-0">
        {backLink && (
          <Link
            href={backLink.href}
            className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors mb-2"
          >
            <ArrowLeft className="w-3 h-3" />
            {backLink.label}
          </Link>
        )}
        {eyebrow && (
          <div className="text-eyebrow text-ink-3 mb-1">
            {eyebrow}
          </div>
        )}
        {info ? (
          <div className="flex items-center gap-2">
            {h1}
            <InfoTip label={infoLabel} className="mt-1">
              {info}
            </InfoTip>
          </div>
        ) : (
          h1
        )}
        {subtitle && (
          <p className="text-ink-2 text-sm mt-1 max-w-2xl">{subtitle}</p>
        )}
        {children}
      </div>
      {rightSlot}
    </div>
  );
}
