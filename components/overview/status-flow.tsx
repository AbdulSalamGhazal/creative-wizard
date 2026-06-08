import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CREATIVE_STATUSES,
  STATUS_DOT,
  STATUS_LABEL,
  type CreativeStatus,
} from "@/lib/creative-status";
import { int } from "@/lib/format";
import type { CreativeStatusTransitions } from "@/db/queries/creative-status";

// SVG coordinate space (scales to container width via viewBox).
const W = 360;
const H = 220;
const PAD = 12;
const LABEL_W = 74;
const NODE_W = 12;
const GAP = 10;
const LEFT_X = LABEL_W;
const RIGHT_X = W - LABEL_W - NODE_W;

interface NodeBox {
  status: CreativeStatus;
  y: number;
  h: number;
}

/**
 * Status flow (a Sankey): how creatives moved between dynamic statuses from the
 * start of the window to now. Left column = status at the start, right column =
 * status now; each ribbon is a group of creatives that moved that way (sized by
 * count), so Active→Pause and Pause→Active appear as separate ribbons.
 */
export function StatusFlow({
  data,
}: {
  data: CreativeStatusTransitions;
}) {
  const { transitions, startCounts, endCounts, total, untouchedNew } = data;

  const startStatuses = CREATIVE_STATUSES.filter((s) => startCounts[s] > 0);
  const endStatuses = CREATIVE_STATUSES.filter((s) => endCounts[s] > 0);
  const maxNodes = Math.max(startStatuses.length, endStatuses.length, 1);
  const avail = H - 2 * PAD - (maxNodes - 1) * GAP;
  const unit = total > 0 ? avail / total : 0;

  const layout = (statuses: CreativeStatus[], counts: Record<CreativeStatus, number>) => {
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

  // Running offsets so stacked ribbons don't overlap within a node.
  const outOff = new Map<CreativeStatus, number>();
  const inOff = new Map<CreativeStatus, number>();
  for (const s of startStatuses) outOff.set(s, leftNodes.get(s)!.y);
  for (const s of endStatuses) inOff.set(s, rightNodes.get(s)!.y);

  // Draw ribbons in (from, to) order so they stack predictably.
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

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Status flow</CardTitle>
        <span className="text-[11px] text-ink-3 font-normal">
          start of period → now
        </span>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center">
        {total === 0 ? (
          <div className="w-full min-h-[140px] flex items-center justify-center text-ink-3 text-sm">
            No status changes in this window.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            className="overflow-visible"
            role="img"
            aria-label="Creative status transitions from the start of the period to now"
          >
            {/* Ribbons */}
            {ribbons.map((r, i) => (
              <path key={i} d={r.path} fill={r.color} fillOpacity={0.3}>
                <title>{r.title}</title>
              </path>
            ))}
            {/* Nodes + labels */}
            {[...leftNodes.values()].map((n) => (
              <g key={`l-${n.status}`}>
                <rect
                  x={LEFT_X}
                  y={n.y}
                  width={NODE_W}
                  height={n.h}
                  rx={2}
                  fill={STATUS_DOT[n.status]}
                />
                <text
                  x={LEFT_X - 6}
                  y={n.y + n.h / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="var(--ink-2)"
                >
                  {STATUS_LABEL[n.status]} {startCounts[n.status]}
                </text>
              </g>
            ))}
            {[...rightNodes.values()].map((n) => (
              <g key={`r-${n.status}`}>
                <rect
                  x={RIGHT_X}
                  y={n.y}
                  width={NODE_W}
                  height={n.h}
                  rx={2}
                  fill={STATUS_DOT[n.status]}
                />
                <text
                  x={RIGHT_X + NODE_W + 6}
                  y={n.y + n.h / 2}
                  textAnchor="start"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="var(--ink-2)"
                >
                  {STATUS_LABEL[n.status]} {endCounts[n.status]}
                </text>
              </g>
            ))}
          </svg>
        )}
        </div>
        {untouchedNew > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 pt-2 mt-1 border-t border-line">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: STATUS_DOT.new }}
            />
            {int(untouchedNew)} untouched · still New (not in the flow)
          </div>
        )}
      </CardContent>
    </Card>
  );
}
