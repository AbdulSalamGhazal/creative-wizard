import Link from "next/link";
import { AlertTriangle, ArrowRight, TrendingUp, Target } from "lucide-react";
import { int, usd } from "@/lib/format";
import type { MoverItem, MoverType } from "@/db/queries/portfolio";

const META: Record<
  MoverType,
  { label: string; icon: typeof AlertTriangle; tone: string }
> = {
  crossed_target: { label: "Crossed target CPA", icon: Target, tone: "text-neg border-neg/40 bg-neg/10" },
  cpa_spike: { label: "CPA spike", icon: TrendingUp, tone: "text-neg border-neg/40 bg-neg/10" },
  spend_up_flat: { label: "Spend up · orders flat", icon: AlertTriangle, tone: "text-warn border-warn/40 bg-warn/10" },
};

function pctStr(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
}

/**
 * Triage panel — auto-surfaced campaigns that need a look this period.
 * Each row links to that campaign's detail for the drill-in.
 */
export function PortfolioMovers({ items }: { items: MoverItem[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3">
        <h3 className="text-sm text-ink-2">Needs attention</h3>
        <p className="text-[10px] text-ink-3">
          Movers vs the comparison period — biggest CPA jumps, target crossings,
          and spend that isn&apos;t buying orders.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          Nothing crossed the alert thresholds this period. 🎉
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((m) => {
            const meta = META[m.type];
            const Icon = meta.icon;
            const detail =
              m.type === "spend_up_flat"
                ? `Spend ${pctStr(m.spendDelta)} · orders ${m.priorOrders}→${m.curOrders}`
                : `CPA ${m.priorCpa === null ? "—" : usd(m.priorCpa)} → ${m.curCpa === null ? "—" : usd(m.curCpa)}`;
            return (
              <li key={`${m.type}-${m.campaign}`}>
                <Link
                  href={`/campaigns/${encodeURIComponent(m.campaign)}`}
                  className="group flex items-center gap-3 py-2.5 hover:bg-surface-2/60 -mx-2 px-2 rounded-md transition-colors"
                >
                  <span
                    className={`inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] border shrink-0 ${meta.tone}`}
                  >
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink truncate">{m.campaign}</div>
                    <div className="text-[11px] text-ink-3 tabular-nums">
                      {detail} · {usd(m.spend)} spend · {int(m.curOrders)} orders
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-ink-3 group-hover:text-ink shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
