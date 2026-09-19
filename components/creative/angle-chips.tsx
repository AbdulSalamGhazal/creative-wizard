import { cn } from "@/lib/utils";

/** How many angle chips a list cell shows before collapsing the rest into +N. */
const MAX_CHIPS = 2;

/**
 * Read-only ANGLE display for list surfaces: at most two chips, each width-
 * capped and truncated, then a "+N" chip whose tooltip names the rest.
 *
 * A creative can carry a dozen angles with long names. Rendered plainly they
 * either wrapped the row to several lines or pushed the column arbitrarily
 * wide, which is what made the Library table unreadable. The guarantee here is
 * structural, not stylistic: the row never wraps (`flex-nowrap`), no chip can
 * exceed its cap, and the overflow is one short chip — so the cell's width is
 * bounded no matter what the data does. The full list is always reachable via
 * the title/aria-label.
 */
export function AngleChips({
  angles,
  className,
}: {
  angles: readonly string[];
  className?: string;
}) {
  if (angles.length === 0) {
    return (
      <span className={cn("text-ink-3", className)} aria-label="No angles">
        —
      </span>
    );
  }
  const shown = angles.slice(0, MAX_CHIPS);
  const rest = angles.slice(MAX_CHIPS);
  const all = angles.join(", ");
  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-nowrap items-center gap-1 overflow-hidden align-middle",
        className,
      )}
      aria-label={`Angles: ${all}`}
      title={all}
    >
      {shown.map((a) => (
        <span
          key={a}
          className="inline-block max-w-[7rem] truncate rounded border border-line bg-surface-2 px-1.5 text-[10px] leading-5 text-ink-2"
        >
          {a}
        </span>
      ))}
      {rest.length > 0 && (
        <span
          className="shrink-0 rounded border border-line bg-surface-2 px-1.5 text-[10px] leading-5 text-ink-3"
          title={rest.join(", ")}
        >
          +{rest.length}
        </span>
      )}
    </span>
  );
}
