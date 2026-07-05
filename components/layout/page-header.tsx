import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  /** Small uppercase kicker above the title (e.g. "Admin"). */
  eyebrow?: string;
  /** Back link rendered above the title. One canonical size everywhere. */
  backLink?: { href: string; label: string };
  title: string;
  /** One-line description under the title. */
  subtitle?: ReactNode;
  /** Right-aligned slot — a primary action button or a context badge. */
  rightSlot?: ReactNode;
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
  rightSlot,
}: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div>
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
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-4xl tracking-tight">{title}</h1>
        {subtitle && <p className="text-ink-2 text-sm mt-1">{subtitle}</p>}
      </div>
      {rightSlot}
    </div>
  );
}
