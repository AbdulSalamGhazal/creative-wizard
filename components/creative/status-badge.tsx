import { cn } from "@/lib/utils";
import {
  STATUS_DOT,
  STATUS_LABEL,
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
