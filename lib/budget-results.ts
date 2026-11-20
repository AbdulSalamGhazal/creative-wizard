import {
  BUDGET_OBJECTIVES,
  combineResults,
  resultFigures,
  round2,
  type RangeBoard,
  type ResultFigures,
} from "@/lib/budget";
import type { BudgetProductSpend } from "@/db/queries/budget";

/**
 * THE RESULTS LENS (2026-11-14, the Budget restructure) — where the money
 * went and what the platforms say it bought, cut three ways: by platform, by
 * objective bucket, by product.
 *
 * Every figure is PLATFORM-REPORTED and raw, with the rules the board's
 * Results column already follows: ratios from component sums
 * (`combineResults`), NULL ≠ 0, and a part that doesn't report a field leaves
 * BOTH sides of that ratio — so a row's shares count only the spend of the
 * parts that report purchases. Never compared with store revenue; no target,
 * no verdict colour.
 *
 * Products have NO plan (budgets are planned by platform × objective), so
 * this lens carries no pacing figure on any dimension.
 */

export const RESULT_DIMENSIONS = ["platform", "objective", "product"] as const;
export type ResultDimension = (typeof RESULT_DIMENSIONS)[number];

export interface ResultRow {
  key: string;
  label: string;
  /** Set on the platform dimension — the row's dot. */
  platform?: string;
  spend: number;
  results: ResultFigures;
  /** Share of spend / of purchases over the rows that report purchases (null = no share). */
  spendShare: number | null;
  purchaseShare: number | null;
  /** purchaseShare − spendShare, in percentage POINTS. */
  gapPts: number | null;
  /**
   * Share of platform-reported purchase value over the rows that report a
   * value (null = this row reports none, or nothing does).
   */
  valueShare: number | null;
}

interface Part {
  spend: number;
  results: ResultFigures;
}

function row(key: string, label: string, parts: Part[], platform?: string) {
  const spend = round2(parts.reduce((s, p) => s + p.spend, 0));
  const reportingSpend = parts
    .filter((p) => p.results.purchases !== null)
    .reduce((s, p) => s + p.spend, 0);
  return { key, label, platform, spend, results: combineResults(parts), reportingSpend };
}

/**
 * The lens's rows for one dimension, biggest spend first, rows with no spend
 * dropped. `products` is the product scan (`budgetProductSeries`) — required
 * for the product dimension only; `inScope` is the platform filter.
 */
export function buildResultRows(input: {
  dimension: ResultDimension;
  board: RangeBoard;
  products?: readonly BudgetProductSpend[] | null;
  inScope?: (platform: string) => boolean;
  platformLabel: (platform: string) => string;
}): ResultRow[] {
  const { dimension, board, platformLabel } = input;
  const inScope = input.inScope ?? (() => true);
  let raw: ReturnType<typeof row>[];
  if (dimension === "platform") {
    raw = board.platforms.map((p) =>
      row(p.key, platformLabel(p.key), [{ spend: p.actual, results: p.results }], p.key),
    );
  } else if (dimension === "objective") {
    raw = BUDGET_OBJECTIVES.map((objective) =>
      row(
        objective,
        objective,
        board.platforms.flatMap((p) => {
          const part = p.resultsByObjective[objective];
          return part ? [part] : [];
        }),
      ),
    );
  } else {
    const byProduct = new Map<string, { label: string; parts: Part[] }>();
    for (const r of input.products ?? []) {
      if (!inScope(r.platform)) continue;
      const entry = byProduct.get(r.productId) ?? { label: r.productName, parts: [] };
      entry.parts.push({
        spend: r.spend,
        results: resultFigures(r.spend, r.purchases, r.purchaseValue),
      });
      byProduct.set(r.productId, entry);
    }
    raw = [...byProduct].map(([key, e]) => row(key, e.label, e.parts));
  }

  const spent = raw.filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend);
  const reporting = spent.filter((r) => r.results.purchases !== null);
  const spendBase = reporting.reduce((s, r) => s + r.reportingSpend, 0);
  const purchaseBase = reporting.reduce((s, r) => s + (r.results.purchases ?? 0), 0);
  const valueBase = spent.reduce((s, r) => s + (r.results.purchaseValue ?? 0), 0);
  return spent.map(({ reportingSpend, ...r }) => {
    const valueShare =
      r.results.purchaseValue === null || valueBase <= 0 ? null : r.results.purchaseValue / valueBase;
    if (r.results.purchases === null || spendBase <= 0) {
      return { ...r, spendShare: null, purchaseShare: null, gapPts: null, valueShare };
    }
    const spendShare = reportingSpend / spendBase;
    const purchaseShare = purchaseBase > 0 ? r.results.purchases / purchaseBase : null;
    return {
      ...r,
      spendShare,
      purchaseShare,
      gapPts: purchaseShare === null ? null : (purchaseShare - spendShare) * 100,
      valueShare,
    };
  });
}
