import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  campaignBenchmark,
  campaignBreakdown,
  campaignBridge,
  campaignRecords,
  campaignRetention,
  type CampaignBridge,
  type Range,
} from "@/db/queries/campaign";
import type { CampaignCompare } from "@/validators/campaign";
import { CampaignRoasBridge } from "@/components/campaign/campaign-roas-bridge";
import { CampaignRetentionZones } from "@/components/campaign/campaign-retention-zones";
import { CampaignRecordsTable } from "@/components/campaign/campaign-records-table";
import { ratio, usd } from "@/lib/format";

interface Args {
  campaign: string;
  range: Range;
  includeExcluded: boolean;
}

const ratioSigned = (v: number) =>
  `${v >= 0 ? "+" : "−"}${ratio(Math.abs(v))}×`;

/** A diagnosis panel card with a number + one-line title and a short hint. */
function Panel({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-surface border-line">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-ink">
            <span className="text-ink-3 num mr-2">{step}</span>
            {title}
          </h2>
          {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Insufficient({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-5 py-10 text-center text-sm text-ink-3">
      {children}
    </div>
  );
}

// ─────────────────────────── 1 · Verdict ───────────────────────────

export async function VerdictPanel({ campaign, range, includeExcluded }: Args) {
  const b = await campaignBenchmark(campaign, range, includeExcluded);

  if (b.campaignRoas <= 0) {
    return (
      <Panel step={1} title="The verdict" hint="vs same-platform peers">
        <Insufficient>No spend with revenue in this window.</Insufficient>
      </Panel>
    );
  }
  if (!b.hasPeers || b.expected <= 0) {
    return (
      <Panel step={1} title="The verdict" hint="vs same-platform peers">
        <Insufficient>
          No same-platform peers in this window to benchmark against.
          <div className="text-ink-2 mt-1 num">
            ROAS {ratio(b.campaignRoas)}×
          </div>
        </Insufficient>
      </Panel>
    );
  }

  const idxColor =
    b.index >= 110 ? "var(--pos)" : b.index < 90 ? "var(--neg)" : "var(--ink)";
  const bandWord =
    b.band === "above" ? "above" : b.band === "under" ? "below" : "on";

  // Bullet geometry (percent of a padded scale).
  const scaleMax = Math.max(b.campaignRoas, b.expected * 1.15, 0.01) * 1.2;
  const p = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));
  const underEnd = p(b.expected * 0.85);
  const parEnd = p(b.expected * 1.15);
  const actual = p(b.campaignRoas);
  const exp = p(b.expected);

  return (
    <Panel step={1} title="The verdict" hint="vs same-platform peers (this platform × these weeks)">
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        <div className="shrink-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-ink-3 mb-1">
            Performance index
          </div>
          <div className="font-display text-6xl leading-none num" style={{ color: idxColor }}>
            {b.index}
          </div>
          <div className="text-[11px] text-ink-3 mt-1">100 = on baseline</div>
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="relative h-9 rounded-lg overflow-hidden bg-surface-2">
            {/* bands */}
            <div className="absolute inset-y-0 left-0" style={{ width: `${underEnd}%`, background: "color-mix(in srgb, var(--neg) 14%, transparent)" }} />
            <div className="absolute inset-y-0" style={{ left: `${underEnd}%`, width: `${parEnd - underEnd}%`, background: "var(--surface-2)" }} />
            <div className="absolute inset-y-0" style={{ left: `${parEnd}%`, right: 0, background: "color-mix(in srgb, var(--pos) 14%, transparent)" }} />
            {/* actual ROAS bar */}
            <div
              className="absolute top-1/2 -translate-y-1/2 left-0 h-3.5 rounded-r"
              style={{ width: `${actual}%`, background: idxColor }}
            />
            {/* expected tick */}
            <div
              className="absolute inset-y-0 w-0.5 bg-ink"
              style={{ left: `${exp}%` }}
              title={`expected ${ratio(b.expected)}×`}
            />
          </div>
          <p className="text-sm text-ink-2">
            <span className="text-ink font-semibold num">{ratio(b.campaignRoas)}×</span>{" "}
            ROAS vs <span className="num">{ratio(b.expected)}×</span> expected for
            same-platform peers — <span className="text-ink font-medium">{bandWord}</span> baseline.
          </p>
        </div>
      </div>
    </Panel>
  );
}

export function VerdictSkeleton() {
  return (
    <Panel step={1} title="The verdict" hint="vs same-platform peers">
      <div className="flex gap-6">
        <Skeleton className="h-16 w-20" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </Panel>
  );
}

// ─────────────── 2 · ROAS bridge + 3 · Contributions ───────────────

function bridgeRead(b: CampaignBridge): string {
  const { mix, rate, delta } = b;
  const rateWord = rate >= 0 ? "creatives' own ROAS improved" : "creatives' own ROAS slipped";
  const mixWord = mix >= 0 ? "budget shifted toward stronger creatives" : "budget drifted toward weaker creatives";
  const dominantRate = Math.abs(rate) >= Math.abs(mix);
  const lead = dominantRate
    ? `Rate ${ratioSigned(rate)} (${rateWord})`
    : `Mix ${ratioSigned(mix)} (${mixWord})`;
  const other = dominantRate
    ? `Mix ${ratioSigned(mix)} (${mixWord})`
    : `Rate ${ratioSigned(rate)} (${rateWord})`;
  const verb =
    Math.sign(rate) === Math.sign(mix) || rate === 0 || mix === 0
      ? "plus"
      : "against";
  return `${lead} ${verb} ${other} → ROAS ${ratioSigned(delta)}.`;
}

function Contribution({ data }: { data: CampaignBridge }) {
  const top = data.contrib.filter((c) => Math.abs(c.total) > 1e-6).slice(0, 6);
  if (top.length === 0) {
    return <p className="text-xs text-ink-3">No creative-level movement to attribute.</p>;
  }
  const max = Math.max(...top.map((c) => Math.abs(c.total)), 1e-6);
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-ink-3">Net contribution to the change, by creative</div>
      <div className="space-y-1.5">
        {top.map((c) => {
          const w = (Math.abs(c.total) / max) * 50; // half-width each side
          const pos = c.total >= 0;
          return (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 truncate text-ink-2 font-mono text-[11px]" title={c.name}>
                {c.name}
              </span>
              <div className="relative flex-1 h-4">
                <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-3 rounded-sm"
                  style={{
                    left: pos ? "50%" : `${50 - w}%`,
                    width: `${w}%`,
                    background: pos ? "var(--pos)" : "var(--neg)",
                  }}
                />
              </div>
              <span className="w-14 shrink-0 text-right num text-ink">
                {ratioSigned(c.total)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export async function BridgeSection({
  campaign,
  range,
  includeExcluded,
  compare,
}: Args & { compare: CampaignCompare }) {
  const b = await campaignBridge(campaign, range, compare, includeExcluded);

  if (!b.hasPrior) {
    return (
      <Panel step={2} title="The ROAS bridge — mix vs rate" hint="current vs prior window">
        <Insufficient>
          No prior-window spend to compare against — the campaign is younger than
          the comparison window.
        </Insufficient>
      </Panel>
    );
  }

  const singleCreative = b.contrib.length <= 1;

  return (
    <>
      <Panel step={2} title="The ROAS bridge — mix vs rate" hint="current vs prior window">
        <CampaignRoasBridge data={b} />
        <p className="text-sm text-ink-2">{bridgeRead(b)}</p>
        {singleCreative && (
          <p className="text-[11px] text-ink-3">
            Single creative — there&rsquo;s no budget-mix effect, only rate.
          </p>
        )}
      </Panel>
      <Panel step={3} title="What drove it — creative contributions">
        <Contribution data={b} />
      </Panel>
    </>
  );
}

export function BridgeSkeleton() {
  return (
    <Panel step={2} title="The ROAS bridge — mix vs rate">
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </Panel>
  );
}

// ─────────────── 4 · Structure (winners / losers / gap) ───────────────

export async function StructurePanel({ campaign, range, includeExcluded }: Args) {
  const s = await campaignBreakdown(campaign, range, includeExcluded);

  if (s.rows.length === 0) {
    return (
      <Panel step={4} title="Inside the campaign — winners, losers & the gap">
        <Insufficient>No creative spend in this window.</Insufficient>
      </Panel>
    );
  }

  const maxSpend = Math.max(...s.rows.map((r) => r.spend), 1);
  const move =
    s.loserCount === 0
      ? "All creatives beat the campaign average — hold the allocation."
      : `Reallocate ${usd(s.loserSpend)} away from ${s.loserCount} below-average creative${s.loserCount === 1 ? "" : "s"}.`;

  return (
    <Panel step={4} title="Inside the campaign — winners, losers & the gap">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile label="Below average" value={`${s.loserCount} / ${s.rows.length}`} sub="creatives under the campaign ROAS" />
        <Tile
          label="Money left on the table"
          value={s.ceilMissed > 0 ? `${usd(s.floorMissed)}–${usd(s.ceilMissed)}` : "$0"}
          sub="if losers matched avg → best"
          accent="var(--warn)"
        />
        <Tile label="Move to make" value="" sub={move} />
      </div>

      <div className="space-y-1.5">
        {s.rows.map((r) => {
          const win = r.roas >= s.campaignAvg;
          return (
            <div key={r.id} className="flex items-center gap-2 text-xs">
              <span
                className={`w-36 shrink-0 truncate font-mono text-[11px] ${r.lowConfidence ? "text-ink-3" : "text-ink-2"}`}
                title={r.name}
              >
                {r.name}
                {r.lowConfidence && <span className="ml-1 text-ink-3">·low</span>}
              </span>
              <div className="flex-1 h-3.5 rounded-sm bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${(r.spend / maxSpend) * 100}%`,
                    background: win ? "var(--pos)" : "var(--neg)",
                    opacity: r.lowConfidence ? 0.45 : 1,
                  }}
                />
              </div>
              <span className="w-16 shrink-0 text-right num text-ink-2">{usd(r.spend)}</span>
              <span className={`w-14 shrink-0 text-right num ${win ? "text-pos" : "text-neg"}`}>
                {ratio(r.roas)}×
              </span>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-ink-3">
        Win/lose is vs this campaign&rsquo;s own average ({ratio(s.campaignAvg)}×).
      </div>
    </Panel>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-2/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</div>
      {value && (
        <div className="font-display text-2xl num leading-tight mt-0.5" style={accent ? { color: accent } : undefined}>
          {value}
        </div>
      )}
      <div className={`text-[11px] text-ink-3 ${value ? "mt-0.5" : "mt-1 text-ink-2"}`}>{sub}</div>
    </div>
  );
}

export function StructureSkeleton() {
  return (
    <Panel step={4} title="Inside the campaign — winners, losers & the gap">
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-24 w-full" />
    </Panel>
  );
}

// ─────────────── 5 · Retention zones (video only) ───────────────

export async function RetentionSection({ campaign, range, includeExcluded }: Args) {
  const data = await campaignRetention(campaign, range, includeExcluded);
  if (!data) return null; // no video → omit the panel entirely
  return (
    <Panel step={5} title="Why the video loses attention" hint="retained viewers by quartile">
      <CampaignRetentionZones data={data} />
      <p className="text-[11px] text-ink-3">
        A steep fall in a zone points at that failure mode — hook (open),
        pacing (middle), or offer (close).
      </p>
    </Panel>
  );
}

// ─────────────── Raw data disclosure ───────────────

export async function RawDataDisclosure({ campaign, range, includeExcluded }: Args) {
  const records = await campaignRecords(campaign, range, includeExcluded);
  return (
    <details className="rounded-xl border border-line bg-surface group">
      <summary className="cursor-pointer select-none px-6 py-4 text-sm font-medium text-ink-2 hover:text-ink marker:text-ink-3">
        Raw data
        <span className="text-ink-3 font-normal ml-2 num">
          {records.length >= 500 ? "first 500 rows" : `${records.length} rows`}
        </span>
      </summary>
      <div className="px-4 pb-4">
        <CampaignRecordsTable rows={records} />
      </div>
    </details>
  );
}

export function RawDataSkeleton() {
  return <Skeleton className="h-12 w-full rounded-xl" />;
}
