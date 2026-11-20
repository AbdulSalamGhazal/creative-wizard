import { Chip } from "@/components/ui/chip";
import { monthDay } from "@/lib/format";

/**
 * LAUNCHED (C7): the creative's or campaign's first-ever real spend falls in
 * the range. Not "New" — that word is the creative status for never-spent.
 * The date rides the hover and the accessible name, not the card.
 */
export function LaunchedTag({ on, size = "sm" }: { on: string | null; size?: "sm" | "md" }) {
  if (!on) return null;
  const when = `First spend ${monthDay(on)}`;
  return (
    <Chip size={size} tone="brand" title={when} aria-label={`Launched — ${when}`}>
      Launched
    </Chip>
  );
}
