/**
 * Auto-detect the platform from a CSV/XLSX header row by scoring each
 * adapter's candidate header set. Avoids the "user picked Meta but the file
 * is TikTok" mistake.
 */
import type { InternalField, PlatformAdapter } from "@/csv/platforms/types";

export interface DetectResult {
  /** The best-scoring platform; null only if no candidate had any header match. */
  platform: PlatformAdapter["platform"] | null;
  /** Total internal-field matches per platform (capped at the number of fields). */
  scores: Record<PlatformAdapter["platform"], number>;
  /** True when the top two platforms tied. */
  ambiguous: boolean;
}

/**
 * One point per internal field that has at least one candidate header present
 * in the file. Higher score = better match.
 */
export function detectPlatform(
  headers: string[],
  adapters: Record<PlatformAdapter["platform"], PlatformAdapter>,
): DetectResult {
  const lowerHeaders = new Set(headers.map((h) => h.trim().toLowerCase()));

  const scores: Record<PlatformAdapter["platform"], number> = {
    meta: 0,
    tiktok: 0,
    snapchat: 0,
    google: 0,
  };

  for (const platform of Object.keys(adapters) as Array<
    PlatformAdapter["platform"]
  >) {
    const adapter = adapters[platform];
    let score = 0;
    for (const field of Object.keys(adapter.headerMap) as InternalField[]) {
      const candidates = adapter.headerMap[field];
      const hit = candidates.some((c) => lowerHeaders.has(c.toLowerCase()));
      if (hit) score++;
    }
    scores[platform] = score;
  }

  let best: PlatformAdapter["platform"] | null = null;
  let topScore = 0;
  for (const platform of Object.keys(scores) as Array<
    PlatformAdapter["platform"]
  >) {
    const s = scores[platform];
    if (s > topScore) {
      topScore = s;
      best = platform;
    }
  }
  if (topScore === 0) {
    return { platform: null, scores, ambiguous: false };
  }

  // Ambiguous if a different platform ties the top score.
  const ambiguous =
    Object.values(scores).filter((s) => s === topScore).length > 1;

  return { platform: best, scores, ambiguous };
}
