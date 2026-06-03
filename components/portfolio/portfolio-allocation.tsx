import { int, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import type { AllocationRow } from "@/db/queries/portfolio";

/**
 * The headline allocation read: for each platform, share-of-spend next to
 * share-of-orders. A platform whose spend share badly outruns its order share
 * is over-funded — the gap chip makes that misallocation obvious at a glance.
 */
export function PortfolioAllocation({ rows }: { rows: AllocationRow[] }) {
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0);

  if (rows.length === 0 || totalSpend === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4">
        <Heading />
        <div className="h-32 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No spend in this window.
        </div>
      </div>
    );
  }

  const data = rows
    .map((r) => {
      const spendShare = totalSpend > 0 ? r.spend / totalSpend : 0;
      const orderShare = totalOrders > 0 ? r.orders / totalOrders : 0;
      return { ...r, spendShare, orderShare, gap: orderShare - spendShare };
    })
    .sort((a, b) => b.spend - a.spend);

  const fmtPct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const fmtGap = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)} pp`;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <Heading />
      <div className="space-y-4 mt-3">
        {data.map((r) => {
          // Gap > +5pp → punching above its spend (good). < -5pp → over-funded.
          const tone =
            r.gap >= 0.05 ? "pos" : r.gap <= -0.05 ? "neg" : "neutral";
          return (
            <div key={r.platform} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: PLATFORM_COLOR[r.platform] }}
                  />
                  {PLATFORM_LABEL[r.platform]}
                </span>
                <span
                  className={
                    tone === "pos"
                      ? "text-pos tabular-nums"
                      : tone === "neg"
                        ? "text-neg tabular-nums"
                        : "text-ink-3 tabular-nums"
                  }
                  title="Order share minus spend share. Positive = over-delivering relative to its budget."
                >
                  {fmtGap(r.gap)}
                </span>
              </div>

              <Bar
                tone="spend"
                share={r.spendShare}
                color={PLATFORM_COLOR[r.platform]}
                left="Spend"
                right={`${fmtPct(r.spendShare)} · ${usd(r.spend)}`}
              />
              <Bar
                tone="orders"
                share={r.orderShare}
                color={PLATFORM_COLOR[r.platform]}
                left="Orders"
                right={`${fmtPct(r.orderShare)} · ${int(r.orders)}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Heading() {
  return (
    <div>
      <h3 className="text-sm text-ink-2">Allocation — spend share vs order share</h3>
      <p className="text-[10px] text-ink-3">
        Where the budget goes vs where the orders come from. Mind the gap.
      </p>
    </div>
  );
}

function Bar({
  tone,
  share,
  color,
  left,
  right,
}: {
  tone: "spend" | "orders";
  share: number;
  color: string;
  left: string;
  right: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-ink-3">
        {left}
      </span>
      <div className="flex-1 h-3 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%`,
            background: color,
            opacity: tone === "spend" ? 0.95 : 0.5,
          }}
        />
      </div>
      <span className="w-32 shrink-0 text-right text-[11px] tabular-nums text-ink-2">
        {right}
      </span>
    </div>
  );
}
