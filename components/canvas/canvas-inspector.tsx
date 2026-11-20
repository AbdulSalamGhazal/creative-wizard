"use client";

import { ArrowRight, Film, Image as ImageIcon, Layers, X } from "lucide-react";
import { MetricCard } from "@/components/overview/metric-card";
import { PlatformDot } from "@/components/ui/platform-dot";
import { StatusDot } from "@/components/ui/status-dot";
import { PriorityStars } from "@/components/creative/priority-stars";
import { PLATFORM_COLOR, RATE_COLOR } from "@/lib/palette";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/creative-status";
import { CAMPAIGN_STATUS_DOT, CAMPAIGN_STATUS_LABEL } from "@/lib/campaign-status";
import { RATING_META } from "@/lib/rating";
import { int, longDate, pct1, roas, usd, usd0 } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CanvasInspection, CanvasNode } from "@/lib/canvas";

/**
 * The CLICK INSPECTOR — a read-only panel beside the canvas (an overlay on a
 * phone). It reads the graph the canvas draws (`inspectFor`): no query, no new
 * number. Non-modal on purpose: the canvas stays clickable, and a click on
 * another node — or on a pairing row here — moves the panel and the focus
 * together. Deliberately NOT importing @xyflow/react (one importer).
 */

const TYPE_ICON = { video: Film, image: ImageIcon, slides: Layers } as const;
type PlatformKey = keyof typeof PLATFORM_COLOR;

function EntityMark({ node }: { node: CanvasNode }) {
  if (node.kind === "campaign") {
    return <PlatformDot platform={node.platform as PlatformKey} size="sm" />;
  }
  const Icon = TYPE_ICON[node.type];
  return <Icon className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />;
}

export function CanvasInspector({
  inspection,
  onInspect,
  onOpen,
  onClose,
  className,
}: {
  inspection: CanvasInspection;
  /** Inspect another entity (a pairing row) — moves focus + panel. */
  onInspect: (entityId: string) => void;
  /** The entity's own page (the brand-aware router lives in the caller). */
  onOpen: (node: CanvasNode) => void;
  /** Esc's twin: clears the focus and closes the panel. */
  onClose: () => void;
  className?: string;
}) {
  const { node, pairings, hiddenPairings } = inspection;
  const isCampaign = node.kind === "campaign";
  const status = isCampaign
    ? { color: CAMPAIGN_STATUS_DOT[node.status], label: CAMPAIGN_STATUS_LABEL[node.status] }
    : { color: STATUS_DOT[node.status], label: STATUS_LABEL[node.status] };

  return (
    <aside
      role="region"
      aria-label={`${node.name} details`}
      className={cn("flex min-h-0 flex-col bg-surface text-xs", className)}
    >
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <EntityMark node={node} />
            <span
              className={cn(
                "truncate text-sm font-medium text-ink",
                !isCampaign && "font-mono",
              )}
              title={node.name}
            >
              {node.name}
            </span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-2">
            <StatusDot color={status.color} label={status.label} />
            {isCampaign ? (
              <span className="tabular-nums" title="Creatives currently spending here / creatives that spent here in the range">
                {node.liveChildren}/{node.totalChildren} live
              </span>
            ) : (
              node.priority !== null && <PriorityStars value={node.priority} />
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          title="Close (Esc)"
          className="-mr-1 rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* Range figures — from the node's own sums. */}
        {/* One row of four on a phone (the overlay is the full canvas width,
            and two rows of headline-size figures pushed the pairings below
            the fold); two by two in the 280px desktop column. */}
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-2">
          <MetricCard variant="quiet" size="sm" hideBreakdown label="Spend" value={usd(node.spend)} />
          <MetricCard variant="quiet" size="sm" hideBreakdown label="ROAS" value={roas(inspection.roas)} />
          <MetricCard variant="quiet" size="sm" hideBreakdown label="Conversions" value={int(node.conversions)} />
          <MetricCard variant="quiet" size="sm" hideBreakdown label="CPA" value={usd(inspection.cpa)} />
        </div>

        {/* Pairings */}
        <p className="text-label mb-1 mt-4 text-ink-3">
          {isCampaign ? "Creatives" : "Campaigns"} · {int(pairings.length)}
        </p>
        {pairings.length === 0 ? (
          <p className="py-2 text-ink-2">No spend in this range.</p>
        ) : (
          <ul className="divide-y divide-line">
            {pairings.map(({ other, edge, share }) => (
              <li key={edge.id}>
                <button
                  type="button"
                  onClick={() => onInspect(other.id)}
                  title={`Inspect ${other.name}`}
                  className="flex w-full items-start gap-2 rounded-sm py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
                >
                  <span className="mt-0.5">
                    <EntityMark node={other} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate",
                        edge.live ? "text-ink" : "text-ink-2",
                        other.kind === "creative" && "font-mono",
                      )}
                    >
                      {other.name}
                    </span>
                    <span className="block text-[11px] text-ink-2">
                      {edge.live
                        ? "live"
                        : edge.lastSpendDay
                          ? `paused since ${longDate(edge.lastSpendDay)}`
                          : "paused"}
                      {share !== null && <> · {pct1(share)}</>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums text-ink">{usd0(edge.spend)}</span>
                    <span
                      className="flex items-center justify-end gap-1 text-[11px] tabular-nums text-ink-2"
                      aria-label={`ROAS ${roas(edge.roas)}, rated ${RATING_META[edge.rate].label}`}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: RATE_COLOR[edge.rate] }}
                        aria-hidden
                      />
                      {edge.rate === "na" ? "N/A" : roas(edge.roas)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {hiddenPairings !== 0 && (
          <p className="mt-2 text-[11px] text-ink-2">
            {hiddenPairings === "unknown"
              ? "The canvas is showing its top pairings only — this list may be partial."
              : `${int(hiddenPairings)} more hidden by the status filter or the size cap.`}
          </p>
        )}
      </div>

      <div className="border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={() => onOpen(node)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          Open {isCampaign ? "campaign" : "creative"}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
