import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { todayIso } from "@/lib/date-presets";
import {
  clampRangeMonths,
  daysInMonth,
  isValidIsoDate,
  monthKey,
  monthStartIso,
} from "@/lib/budget";
import { MONTH_KEY } from "@/validators/budget";
import { budgetPacingSeries } from "@/db/queries/budget";
import {
  audienceSnapshotSeries,
  latestAudienceSnapshots,
  recentAudienceSnapshots,
} from "@/db/queries/audience";
import { dataHorizon } from "@/db/queries/series-bounds";
import { AudienceBoard } from "@/components/budget/audience-board";

export const dynamic = "force-dynamic";

export const metadata = { title: "Audience" };

/** Last day of the month a YYYY-MM key names. */
function monthEndIso(month: string): string {
  const start = monthStartIso(month);
  return `${start.slice(0, 8)}${daysInMonth(start)}`;
}

/**
 * Budget Audience — how big each funnel audience is, per stage per platform,
 * against what we spend on it.
 *
 * Sizes are measured by hand and IRREGULARLY, so everything here is built on
 * sparse snapshots: the last known value carries forward as a step, every
 * number shows its age, and days before a pair's first measurement stay
 * unknown rather than zero (`lib/audience.ts`).
 *
 * Range resolution matches Pacing: an explicit from/to, else the `?month=` the
 * Budget nav links carry, else the current month. Spend comes from
 * `budgetPacingSeries` — the same scan Pacing uses, never a second one.
 */
export default async function BudgetAudiencePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; month?: string; stage?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIso();

  let from: string;
  let to: string;
  if (isValidIsoDate(sp.from) && isValidIsoDate(sp.to) && sp.from <= sp.to) {
    ({ from, to } = clampRangeMonths(sp.from, sp.to));
  } else {
    const month = sp.month && MONTH_KEY.test(sp.month) ? sp.month : monthKey(today);
    from = monthStartIso(month);
    to = monthEndIso(month);
  }

  const user = await auth();
  const canManage = user ? can(user, "audience.manage") : false;

  const [audience, latest, recent, spend, horizon] = await Promise.all([
    audienceSnapshotSeries(from, to),
    latestAudienceSnapshots(),
    recentAudienceSnapshots(),
    budgetPacingSeries(from, to),
    dataHorizon(),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Budget"
        title="Audience"
        subtitle="How big each funnel audience is, measured by hand, against what it costs to reach. Sizes carry forward from the last measurement — with its age shown — and spend is raw, unfiltered."
      />
      <AudienceBoard
        from={from}
        to={to}
        today={today}
        stage={sp.stage}
        audience={audience}
        latest={latest}
        recent={recent}
        spend={spend.spend}
        horizon={horizon}
        canManage={canManage}
      />
    </PageShell>
  );
}
