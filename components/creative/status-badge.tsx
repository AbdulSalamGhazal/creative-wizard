import { cn } from "@/lib/utils";
import {
  STATUS_DOT,
  STATUS_LABEL,
  STATUS_LETTER,
  type CreativeStatus,
  type PlatformStatus,
} from "@/lib/creative-status";

/**
 * The dynamic creative-status badge — a colored dot + label, shared by every
 * surface (Library, Summary, detail, campaign, trends) so the four states read
 * identically everywhere. `general` accepts the whole-creative status (incl.
 * "new"); per-platform cells pass active/pause/terminated.
 */
export function StatusBadge({
  status,
  className,
  dotOnly = false,
  dotClassName,
}: {
  status: CreativeStatus | PlatformStatus;
  className?: string;
  dotOnly?: boolean;
  /** Override the dot size/shape (e.g. a bigger dot in dense tables). */
  dotClassName?: string;
}) {
  const s = status as CreativeStatus;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-ink-2", className)}
      title={STATUS_LABEL[s]}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClassName)}
        style={{ background: STATUS_DOT[s] }}
      />
      {!dotOnly && STATUS_LABEL[s]}
    </span>
  );
}

/**
 * Compact square status chip — a single letter (N/A/P/T) in the status color,
 * on a faint tint with a matching border. Built for dense tables where a
 * colored dot reads as ambiguous; the full label is in the title.
 */
export function StatusSquare({
  status,
  className,
}: {
  status: CreativeStatus | PlatformStatus;
  className?: string;
}) {
  const s = status as CreativeStatus;
  const color = STATUS_DOT[s];
  return (
    <span
      title={STATUS_LABEL[s]}
      aria-label={STATUS_LABEL[s]}
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center rounded-[3px] border text-[9px] font-semibold leading-none tabular-nums",
        className,
      )}
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      {STATUS_LETTER[s]}
    </span>
  );
}
