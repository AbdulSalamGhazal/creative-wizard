import { evaluateOffer, type OfferResult } from "./evaluate";
import { overallStatus } from "./metrics";
import { resolveRoasTarget, roasNeeded } from "./targets";
import type { Offer, Product, Status, Target, VersionData } from "./types";

/**
 * Every offer of a version evaluated once, with what the pages read off it:
 * the overall status against the enabled targets and the ROAS / max CPA the
 * ROAS target asks of it. Pages derive their tables and charts from this.
 */
export interface OfferRow {
  product: Product;
  offer: Offer;
  r: OfferResult;
  overall: Status | null;
  /** +∞ when nothing is left for ads; NaN when there is no ROAS target. */
  roasA: number;
  roasB: number;
  cpaA: number;
  cpaB: number;
}

export interface Evaluated {
  rows: OfferRow[];
  roasTarget: Target | null;
  enabledTargets: Target[];
}

export function evaluateAll(data: VersionData): Evaluated {
  const roasTarget = resolveRoasTarget(data.targets, data.roasTargetId);
  const enabledTargets = data.targets.filter((t) => t.enabled);
  const rows: OfferRow[] = [];
  for (const product of data.products) {
    for (const offer of product.offers) {
      const r = evaluateOffer(product, offer, data.settings);
      let roasA = NaN;
      let roasB = NaN;
      let cpaA = NaN;
      let cpaB = NaN;
      if (roasTarget && (roasTarget.metric === "margin" || roasTarget.metric === "profit" || roasTarget.metric === "profitPerUnit")) {
        const a = roasNeeded(r, roasTarget.metric, roasTarget.a, data.settings.usdToSar);
        const b = roasNeeded(r, roasTarget.metric, roasTarget.b, data.settings.usdToSar);
        roasA = a.roas;
        roasB = b.roas;
        cpaA = a.maxCpaUsd;
        cpaB = b.maxCpaUsd;
      }
      rows.push({ product, offer, r, overall: overallStatus(r, enabledTargets), roasA, roasB, cpaA, cpaB });
    }
  }
  return { rows, roasTarget, enabledTargets };
}

/** Status counts for a set of rows: how many hit B, hit A, miss. */
export function statusCounts(rows: readonly { overall: Status | null }[]): Record<Status, number> {
  const out: Record<Status, number> = { b: 0, a: 0, miss: 0 };
  for (const row of rows) if (row.overall) out[row.overall] += 1;
  return out;
}
