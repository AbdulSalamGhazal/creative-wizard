import { cn } from "@/lib/utils";
import type { Blend } from "@/price-structure/engine/blend";
import type { Status } from "@/price-structure/engine/types";
import { money0, pct1, roas2, usd0 } from "@/price-structure/format";
import { STATUS_META } from "../palette";

export interface Verdict {
  status: Status;
  gap: number;
  hasRoasTarget: boolean;
}

/** The actual period's status (brief §6.4): none without spend or orders. */
export function verdictOf(actual: Blend, baked: Blend, roasA: number, hasSpend: boolean, hasRoasTarget: boolean): Verdict | null {
  if (!hasSpend || baked.orders === 0) return null;
  const gap = actual.platformRoas / baked.platformRoas - 1;
  const status: Status = actual.platformRoas >= baked.platformRoas ? "b" : hasRoasTarget && actual.platformRoas >= roasA ? "a" : "miss";
  return { status, gap, hasRoasTarget };
}

const TITLE: Record<Status, string> = {
  b: "On or ahead of plan.",
  a: "Behind plan, still meets target A.",
  miss: "Behind plan and below target A.",
};

const BOX: Record<Status, string> = {
  b: "border-pos/40 bg-pos/10",
  a: "border-warn/40 bg-warn/10",
  miss: "border-neg/40 bg-neg/10",
};

/** The verdict box (brief §6.4): coloured by status, three sentences the team reads first. */
export function VerdictBox({ verdict, actual, baked, planB, days, usdToSar }: { verdict: Verdict; actual: Blend; baked: Blend; planB: Blend; days: number; usdToSar: number }) {
  const meta = STATUS_META[verdict.status];
  const ahead = verdict.gap >= 0;
  const mixDiff = baked.platformRoas / planB.platformRoas - 1;
  const mixLine =
    !Number.isFinite(mixDiff) || Math.abs(mixDiff) < 0.01
      ? "The mix you sold was close to the plan, so the gap is about ad efficiency."
      : mixDiff > 0
        ? "You sold more of the high-ROAS offers than planned, which raised the bar. Part of the gap is mix, not ads."
        : "You sold more of the low-ROAS offers than planned, which lowered the bar.";
  const spendDiff = (actual.adSpend - baked.adSpend) * days;
  const title = verdict.status === "miss" && !verdict.hasRoasTarget ? "Behind plan." : TITLE[verdict.status];
  return (
    <div className={cn("rounded-lg border p-3 text-sm", BOX[verdict.status])} role="status">
      <p className="font-medium text-ink">
        <span className={cn("mr-1.5", meta.text)} aria-hidden>
          {meta.icon}
        </span>
        {title}
      </p>
      <p className="mt-1 text-ink-2">
        Ads returned <b className="text-ink num tabular-nums">{roas2(actual.platformRoas)}</b>. The mix you actually sold needed{" "}
        <b className="text-ink num tabular-nums">{roas2(baked.platformRoas)}</b>, so you were{" "}
        <b className={cn("num tabular-nums", ahead ? "text-pos" : "text-neg")}>
          {pct1(Math.abs(verdict.gap))} {ahead ? "ahead" : "behind"}
        </b>
        .
      </p>
      <p className="mt-1 text-ink-2">
        Your plan&rsquo;s mix needed <span className="num tabular-nums text-ink">{roas2(planB.platformRoas)}</span>. {mixLine}
      </p>
      <p className="mt-1 text-ink-2">
        You spent <span className="num tabular-nums text-ink">{usd0(Math.abs(spendDiff) / usdToSar)}</span> {spendDiff >= 0 ? "more" : "less"} than the baked-in CPAs allow, so CML was{" "}
        <span className="num tabular-nums text-ink">{money0(actual.profit * days)} SAR</span> instead of{" "}
        <span className="num tabular-nums text-ink">{money0(baked.profit * days)} SAR</span>.
      </p>
    </div>
  );
}
