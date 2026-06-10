import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CREATIVE_STATUSES,
  STATUS_DOT,
  STATUS_LABEL,
  type CreativeStatus,
} from "@/lib/creative-status";
import { int } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import type {
  CreativeStatusTransitions,
  StatusFlowScope,
} from "@/db/queries/creative-status";

// SVG coordinate space (scales to its cell width via viewBox).
const W = 360;
const H = 230;
const PAD = 12;
const LABEL_W = 70;
const NODE_W = 11;
const GAP = 9;
const LEFT_X = LABEL_W;
const RIGHT_X = W - LABEL_W - NODE_W;

interface NodeBox {
  status: CreativeStatus;
  y: number;
  h: number;
}

/** One Sankey: status at the start of the window → status now, for a single
 *  scope (a platform, or a campaign). Identical shape to the old single flow. */
function StatusFlowDiagram({ data }: { data: CreativeStatusTransitions }) {
  const { transitions, startCounts, endCounts, total } = data;
  const startStatuses = CREATIVE_STATUSES.filter((s) => startCounts[s] > 0);
  const endStatuses = CREATIVE_STATUSES.filter((s) => endCounts[s] > 0);
  const maxNodes = Math.max(startStatuses.length, endStatuses.length, 1);
  const avail = H - 2 * PAD - (maxNodes - 1) * GAP;
  const unit = total > 0 ? avail / total : 0;

  const layout = (
    statuses: CreativeStatus[],
    counts: Record<CreativeStatus, number>,
  ) => {
    const map = new Map<CreativeStatus, NodeBox>();
    let y = PAD;
    for (const s of statuses) {
      const h = Math.max(2, counts[s] * unit);
      map.set(s, { status: s, y, h });
      y += h + GAP;
    }
    return map;
  };

  const leftNodes = layout(startStatuses, startCounts);
  const rightNodes = layout(endStatuses, endCounts);

  const outOff = new Map<CreativeStatus, number>();
  const inOff = new Map<CreativeStatus, number>();
  for (const s of startStatuses) outOff.set(s, leftNodes.get(s)!.y);
  for (const s of endStatuses) inOff.set(s, rightNodes.get(s)!.y);

  const ribbons: { path: string; color: string; title: string }[] = [];
  for (const f of startStatuses) {
    for (const t of endStatuses) {
      const tr = transitions.find((x) => x.from === f && x.to === t);
      if (!tr || tr.count <= 0) continue;
      const th = tr.count * unit;
      const sy = outOff.get(f)!;
      const ty = inOff.get(t)!;
      const x0 = LEFT_X + NODE_W;
      const x1 = RIGHT_X;
      const xc = (x0 + x1) / 2;
      const path = `M ${x0} ${sy} C ${xc} ${sy}, ${xc} ${ty}, ${x1} ${ty} L ${x1} ${ty + th} C ${xc} ${ty + th}, ${xc} ${sy + th}, ${x0} ${sy + th} Z`;
      ribbons.push({
        path,
        color: STATUS_DOT[f],
        title: `${STATUS_LABEL[f]} → ${STATUS_LABEL[t]}: ${tr.count}`,
      });
      outOff.set(f, sy + th);
      inOff.set(t, ty + th);
    }
  }

  if (total === 0) {
    return (
      <div className="h-[140px] flex items-center justify-center text-ink-3 text-[11px] border border-dashed border-line rounded-md">
        No status changes here
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="overflow-visible"
      role="img"
    >
      {ribbons.map((r, i) => (
        <path key={i} d={r.path} fill={r.color} fillOpacity={0.3}>
          <title>{r.title}</title>
        </path>
      ))}
      {[...leftNodes.values()].map((n) => (
        <g key={`l-${n.status}`}>
          <rect x={LEFT_X} y={n.y} width={NODE_W} height={n.h} rx={2} fill={STATUS_DOT[n.status]} />
          <text x={LEFT_X - 6} y={n.y + n.h / 2} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--ink-2)">
            {STATUS_LABEL[n.status]} {startCounts[n.status]}
          </text>
        </g>
      ))}
      {[...rightNodes.values()].map((n) => (
        <g key={`r-${n.status}`}>
          <rect x={RIGHT_X} y={n.y} width={NODE_W} height={n.h} rx={2} fill={STATUS_DOT[n.status]} />
          <text x={RIGHT_X + NODE_W + 6} y={n.y + n.h / 2} textAnchor="start" dominantBaseline="middle" fontSize={10} fill="var(--ink-2)">
            {STATUS_LABEL[n.status]} {endCounts[n.status]}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Four status-flow diagrams in one row — one per platform (Instagram / Facebook
 * / TikTok / Snapchat) by default, or one per top-spend campaign when a single
 * platform is filtered. No all-platforms roll-up, so the "Pause → New" illusion
 * (an artifact of squashing 5 platforms into one word) can't appear.
 */
export function StatusFlowGrid({
  scopes,
  dimension,
}: {
  scopes: StatusFlowScope[];
  dimension: "platform" | "campaign";
}) {
  const labelFor = (key: string) =>
    dimension === "platform"
      ? PLATFORM_LABEL[key as keyof typeof PLATFORM_LABEL] ?? key
      : key;
  const colorFor = (key: string) =>
    dimension === "platform"
      ? PLATFORM_COLOR[key as keyof typeof PLATFORM_COLOR] ?? "var(--ink-2)"
      : "var(--ink-2)";

  return (
    <Card className="bg-surface border-line">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Status flow</CardTitle>
        <span className="text-[11px] text-ink-3 font-normal">
          {dimension === "campaign" ? "top campaigns · " : "by platform · "}
          start of period → now
        </span>
      </CardHeader>
      <CardContent>
        {scopes.length === 0 ? (
          <div className="min-h-[140px] flex items-center justify-center text-ink-3 text-sm">
            No status data in this window.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6">
            {scopes.map((sc) => (
              <div key={sc.key} className="min-w-0">
                <span
                  className="block truncate text-xs font-semibold"
                  style={{ color: colorFor(sc.key) }}
                  title={labelFor(sc.key)}
                >
                  {labelFor(sc.key)}
                </span>
                {sc.data.untouchedNew > 0 ? (
                  <span className="flex items-center gap-1.5 text-[10px] text-ink-3 mt-0.5 mb-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: STATUS_DOT.new }}
                    />
                    +{int(sc.data.untouchedNew)}{" "}
                    {dimension === "campaign" ? "not in campaign" : "never ran"} ·
                    New
                  </span>
                ) : (
                  <span className="block h-[18px]" />
                )}
                <StatusFlowDiagram data={sc.data} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
