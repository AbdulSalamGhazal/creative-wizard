import { shiftIso } from "@/lib/date-presets";
import type { platformEnum } from "@/lib/enums";

type Platform = (typeof platformEnum)[number];

/**
 * An entity's Activity — the pure layer (2026-11-07).
 *
 * A creative's, campaign's or budget month's history is its audit events
 * (linked through `audit_event_entities`) plus two things nobody DID, which the
 * data says happened: it WENT LIVE on a platform, and it STOPPED there. Status
 * is derived from spend and never stored (creative-status domain), so these
 * are derived too, at read time, by the SAME rule the status badge uses: a
 * platform is live on day D when it spent within the window ending at D, and
 * the platform's own latest spend day is where "today" is (each platform
 * anchors to its OWN freshness).
 *
 * A PLAIN module: the API route and the client panel both read it.
 */

export const ENTITY_ACTIVITY_TYPES = [
  "creative",
  "campaign",
  "budget_month",
  "ps_version",
  "landing_page",
] as const;
export type EntityActivityType = (typeof ENTITY_ACTIVITY_TYPES)[number];

/** One audit event as the panel draws it — phrased on the server. */
export interface EntityActivityRow {
  id: number;
  /** ISO timestamp. */
  at: string;
  action: string;
  label: string;
  summary: string | null;
  /** The OTHER thing the event was about (an upload, a rule), or null. */
  about: string | null;
  /** Null = no signed-in actor (a system event). */
  actor: { name: string; avatarUrl: string | null } | null;
}

/** Audit events per page of the panel. */
export const ENTITY_ACTIVITY_PAGE = 30;

export interface StatusEvent {
  platform: Platform;
  kind: "live" | "stopped";
  /** The day it happened (YYYY-MM-DD): the first spend day, or the first day past the window. */
  day: string;
  /** For "stopped": the last day it spent. */
  lastSpend?: string;
}

/**
 * Runs of spend → "went live" / "stopped" events, newest first.
 *
 * `days` are the distinct days the entity spent (> 0, not excluded) on each
 * platform. A run is a stretch where no gap reaches the window: spending on
 * day `d`, then not again until after `d + windowDays - 1`, means the platform
 * went quiet — it "stopped" on `d + windowDays` (the first day the badge
 * would say Pause). The last run stops only when that day has ARRIVED by the
 * platform's own latest spend day; otherwise it is still live.
 */
export function statusEvents(
  days: Partial<Record<Platform, readonly string[]>>,
  latestDayByPlatform: Partial<Record<Platform, string>>,
  windowDays: number,
): StatusEvent[] {
  const w = Math.max(1, Math.floor(windowDays));
  const out: StatusEvent[] = [];
  for (const [platform, list] of Object.entries(days) as Array<[Platform, readonly string[]]>) {
    const sorted = [...new Set(list)].sort();
    if (sorted.length === 0) continue;
    let runStart = sorted[0]!;
    let prev = sorted[0]!;
    const close = (last: string) => {
      out.push({ platform, kind: "live", day: runStart });
      out.push({ platform, kind: "stopped", day: shiftIso(last, w), lastSpend: last });
    };
    for (const day of sorted.slice(1)) {
      // Live through prev + w − 1 on the window alone; spending again ON
      // prev + w keeps it live. Only a next spend day PAST prev + w means
      // the badge said Pause on prev + w.
      if (day > shiftIso(prev, w)) {
        close(prev);
        runStart = day;
      }
      prev = day;
    }
    const latest = latestDayByPlatform[platform];
    const stopsOn = shiftIso(prev, w);
    if (latest && latest >= stopsOn) close(prev);
    else out.push({ platform, kind: "live", day: runStart });
  }
  // Newest first; on one day a stop sorts above a start (it is the later state).
  return out.sort((a, b) =>
    a.day === b.day ? (a.kind === b.kind ? 0 : a.kind === "stopped" ? -1 : 1) : a.day < b.day ? 1 : -1,
  );
}

/**
 * Which derived events to show beside the audit rows loaded so far: all of
 * them once every page is in, otherwise only those no older than the oldest
 * loaded row — so a "went live" never jumps ahead of edits not yet fetched.
 */
export function visibleStatusEvents(
  events: readonly StatusEvent[],
  oldestLoadedAt: Date | null,
  allLoaded: boolean,
): StatusEvent[] {
  if (allLoaded || oldestLoadedAt === null) return allLoaded ? [...events] : [];
  const floor = oldestLoadedAt.toISOString().slice(0, 10);
  return events.filter((e) => e.day >= floor);
}
