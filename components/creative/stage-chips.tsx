import { cn } from "@/lib/utils";
import { NA_STAGE, STAGE_SHORT, sortStages, stageLabel } from "@/lib/funnel-stages";

/**
 * Read-only STAGE display for list surfaces — compact TOF / MOF / BOF chips,
 * in funnel order. Unassigned renders an em-dash: nobody has declared a stage,
 * which is a real state and not a zero. **`N/A` is the other thing** — someone
 * DID look and declared no clear stage — so it renders as its own muted chip,
 * never as the em-dash.
 *
 * The chips are neutral (no warn/pos/neg tint): Stage is a declaration of where
 * a creative sits, never a verdict on it. The full names ride in the label for
 * assistive tech and on hover.
 */
export function StageChips({
  stages,
  className,
  nowrap = false,
}: {
  stages: readonly string[];
  className?: string;
  /**
   * Keep the (at most three, always short) chips on ONE line — the Library
   * table's never-overflow guarantee. Off by default so every other surface
   * keeps exactly the behaviour it had.
   */
  nowrap?: boolean;
}) {
  const ordered = sortStages(stages);
  if (ordered.length === 0) {
    return (
      <span className={cn("text-ink-3", className)} aria-label="Unassigned">
        —
      </span>
    );
  }
  const full = ordered.map(stageLabel).join(" · ");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        // With `nowrap` the cell can't grow a row taller or push a column
        // wider — three short chips always fit on one line.
        nowrap ? "flex-nowrap whitespace-nowrap" : "flex-wrap",
        className,
      )}
      aria-label={`Stage: ${full}`}
      title={full}
    >
      {ordered.map((s) => (
        <span
          key={s}
          className={cn(
            "inline-flex h-5 items-center rounded border px-1.5 text-[10px]",
            // Muted: a declaration, but not a place in the funnel.
            s === NA_STAGE
              ? "border-dashed border-line bg-transparent text-ink-3"
              : "border-line bg-surface-2 text-ink-2",
          )}
        >
          {STAGE_SHORT[s]}
        </span>
      ))}
    </span>
  );
}
