import { platformEnum } from "@/db/schema";

export type Platform = (typeof platformEnum)[number];

/**
 * Dynamic creative status. Three states are DERIVED from spend; `terminated`
 * is the only manual, sticky one (set per platform via
 * `creative_platform_overrides`).
 *
 *  - new:        the creative has never spent anywhere.
 *  - active:     spending within the configured window on ≥1 platform.
 *  - pause:      has spent before, but not within the window on any platform.
 *  - terminated: (general) terminated on every platform it has presence on.
 *
 * Per-platform we only surface active/pause/terminated — "new" is a
 * whole-creative "hasn't started" concept.
 */
export const CREATIVE_STATUSES = ["new", "active", "pause", "terminated"] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

export type PlatformStatus = "active" | "pause" | "terminated";

/** Sort rank (most-relevant → least): active ▸ pause ▸ new ▸ terminated. */
export const STATUS_ORDER: Record<CreativeStatus, number> = {
  active: 0,
  pause: 1,
  new: 2,
  terminated: 3,
};

export const STATUS_LABEL: Record<CreativeStatus, string> = {
  new: "New",
  active: "Active",
  pause: "Pause",
  terminated: "Terminated",
};

/** Dot/badge color per status (theme CSS vars). Four distinct tones:
 *  gray = not started, green = running, amber = paused, red = terminated. */
export const STATUS_DOT: Record<CreativeStatus, string> = {
  new: "var(--ink-3)",
  active: "var(--pos)",
  pause: "var(--warn)",
  terminated: "var(--neg)",
};

/** Convert the per-brand window (hours) to whole days; daily-grain data rounds
 *  up, with a floor of 1 (24h ⇒ 1 = the platform's latest data day only). */
export function hoursToWindowDays(hours: number): number {
  return Math.max(1, Math.ceil((hours || 24) / 24));
}

/** Subtract whole days from an ISO YYYY-MM-DD date (UTC). */
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface CreativeStatusInput {
  /** Platforms the creative has spent on, with its last spend date (YYYY-MM-DD). */
  lastSpendByPlatform: Partial<Record<Platform, string>>;
  /** Platforms the creative is manually terminated on. */
  terminatedPlatforms: Platform[];
}

export interface StatusContext {
  /** Each platform's latest data day in the brand (YYYY-MM-DD) — the freshness
   *  anchor, since uploads are per-platform. */
  latestDayByPlatform: Partial<Record<Platform, string>>;
  /** Active window in whole days (see hoursToWindowDays). */
  windowDays: number;
}

export interface CreativeStatusResult {
  general: CreativeStatus;
  /** Per-platform status for platforms with presence (ran or terminated). */
  perPlatform: Partial<Record<Platform, PlatformStatus>>;
}

/**
 * Derive one creative's per-platform + general status. Each platform is judged
 * against ITS OWN latest data day (so a stale upload on one channel can't make
 * a still-running creative look paused). General roll-up precedence:
 * active ▸ pause ▸ terminated ▸ new.
 */
export function deriveCreativeStatus(
  input: CreativeStatusInput,
  ctx: StatusContext,
): CreativeStatusResult {
  const terminated = new Set(input.terminatedPlatforms);
  const perPlatform: Partial<Record<Platform, PlatformStatus>> = {};

  const platforms = new Set<Platform>([
    ...(Object.keys(input.lastSpendByPlatform) as Platform[]),
    ...input.terminatedPlatforms,
  ]);

  let anyActive = false;
  let anyPause = false;

  for (const p of platforms) {
    if (terminated.has(p)) {
      perPlatform[p] = "terminated";
      continue;
    }
    const last = input.lastSpendByPlatform[p];
    if (!last) continue; // no spend + not terminated → nothing to show
    const anchor = ctx.latestDayByPlatform[p];
    const threshold = anchor ? isoMinusDays(anchor, ctx.windowDays - 1) : null;
    if (threshold && last >= threshold) {
      perPlatform[p] = "active";
      anyActive = true;
    } else {
      perPlatform[p] = "pause";
      anyPause = true;
    }
  }

  // "Terminated" as general ONLY when every one of the 5 platforms has been
  // explicitly terminated. If any platform is "New" (never spent, never
  // terminated), the creative still has unused potential → general = New.
  // Precedence: Active > Pause > New > Terminated.
  const hasAnyNew = platformEnum.some(
    (p) =>
      !input.lastSpendByPlatform[p as Platform] &&
      !terminated.has(p as Platform),
  );

  let general: CreativeStatus;
  if (anyActive) general = "active";
  else if (anyPause) general = "pause";
  else if (hasAnyNew) general = "new";
  else general = "terminated"; // only when all 5 platforms are explicitly terminated

  return { general, perPlatform };
}

/** Fallback for a creative absent from the status map (never spent, never
 *  terminated). */
export const NEW_STATUS: CreativeStatusResult = { general: "new", perPlatform: {} };
