import { cn } from "@/lib/utils";

/**
 * THE status look — a coloured dot + its label — for every entity status: a
 * creative's New / Active / Paused / Terminated and a campaign's Active /
 * Inactive read the same on every table and header. The colour comes from the
 * entity's own map (`STATUS_DOT`, `CAMPAIGN_STATUS_DOT`) and carries the state;
 * the label stays in the muted ink. Pure render — safe on server or client.
 */
export function StatusDot({
  color,
  label,
  className,
  dotClassName,
  dotOnly = false,
}: {
  color: string;
  label: string;
  className?: string;
  /** Override the dot size/shape (e.g. a bigger dot in dense tables). */
  dotClassName?: string;
  dotOnly?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2", className)}
      title={label}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClassName)}
        style={{ background: color }}
      />
      {!dotOnly && label}
    </span>
  );
}
