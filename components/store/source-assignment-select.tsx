"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { useNavTransition } from "@/lib/nav-progress";
import { setStoreSourceMapping } from "@/app/actions/store-source";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { cn } from "@/lib/utils";

/** What a raw `utm_source` value can be assigned to. */
export type SourceAssignment = (typeof ALL_PLATFORMS)[number] | "none" | "unset";

/** A mapping row's platform (NULL = "not an ad platform") → the select's value. */
export function sourceAssignmentOf(
  mapped: boolean,
  platform: string | null | undefined,
): SourceAssignment {
  if (!mapped) return "unset";
  return (platform ?? "none") as SourceAssignment;
}

/**
 * THE control that assigns a raw source value to a platform — shared by the
 * Order fields tab (every value in the brand's orders) and the UTMs page's
 * hygiene list (the unmapped ones in range), so the two can never offer a
 * different vocabulary. Owns its own pending state; the action's response
 * re-renders the caller's page (ONE render per action), so there is nothing
 * to refresh here.
 */
export function SourceAssignmentSelect({
  rawValue,
  current,
  className,
  size = "md",
}: {
  rawValue: string;
  current: SourceAssignment;
  className?: string;
  /** `sm` for a dense list row. */
  size?: "sm" | "md";
}) {
  const [isPending, startTransition] = useNavTransition();

  function assign(assignment: SourceAssignment) {
    startTransition(async () => {
      const res = await safeAction(() => setStoreSourceMapping({ rawValue, assignment }));
      if (!res.ok) toastActionFailure(res, "Couldn't save the mapping");
    });
  }

  return (
    <Select
      value={current}
      onValueChange={(a) => assign(a as SourceAssignment)}
      disabled={isPending}
    >
      <SelectTrigger
        className={cn(size === "sm" ? "h-7 w-40 text-xs" : "h-8 w-48", "shrink-0", className)}
        aria-label={`Map “${rawValue}”`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ALL_PLATFORMS.map((p) => (
          <SelectItem key={p} value={p}>
            <span className="flex items-center gap-2">
              <PlatformDot platform={p} size="sm" />
              {PLATFORM_LABEL[p]}
            </span>
          </SelectItem>
        ))}
        <SelectItem value="none">Not an ad platform</SelectItem>
        <SelectItem value="unset">Unmapped</SelectItem>
      </SelectContent>
    </Select>
  );
}
