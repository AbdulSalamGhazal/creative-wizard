import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import {
  STATUS_DOT,
  STATUS_LABEL,
  STATUS_LETTER,
  type CreativeStatus,
  type PlatformStatus,
} from "@/lib/creative-status";

/**
 * The dynamic creative-status badge — the shared `StatusDot` (dot + label),
 * on every surface (Library, Summary, detail, campaign, trends) so the four
 * states read identically everywhere, and like a campaign's status. `general` accepts the whole-creative status (incl.
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
    <StatusDot
      color={STATUS_DOT[s]}
      label={STATUS_LABEL[s]}
      className={className}
      dotClassName={dotClassName}
      dotOnly={dotOnly}
    />
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
