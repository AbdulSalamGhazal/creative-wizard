import { cn } from "@/lib/utils";
import type { Status } from "@/price-structure/engine/types";
import { STATUS_META } from "./palette";
import { Chip } from "@/components/ui/chip";

/**
 * The status chip (brief §8.2): ✓ Hits B · ◐ Hits A · ✕ Misses A. The
 * compact variant — tiles, offer headers, table cells — shows the icon and
 * "B" / "A" / "Miss" with the full label as its title.
 */
export function StatusBadge({
  status,
  compact = false,
  title,
  className,
}: {
  status: Status;
  compact?: boolean;
  /** Replaces the default title (e.g. "CML %: A 25.0%, B 35.0%"). */
  title?: string;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <Chip
      tone="solid"
      title={title ?? meta.label}
      aria-label={meta.label}
      className={cn(!compact && "h-6 px-2", meta.chip, className)}
    >
      <span aria-hidden>{meta.icon}</span>
      {compact ? meta.short : meta.label}
    </Chip>
  );
}
