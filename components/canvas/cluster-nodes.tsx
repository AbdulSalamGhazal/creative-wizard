"use client";

import { memo } from "react";
import { Film, Image as ImageIcon, Layers, Lightbulb } from "lucide-react";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PLATFORM_COLOR, RATE_COLOR } from "@/lib/palette";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/creative-status";
import {
  CAMPAIGN_STATUS_DOT,
  CAMPAIGN_STATUS_LABEL,
} from "@/lib/campaign-status";
import { int, roas, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CanvasAngleHeader, CanvasChip, CanvasLens, CanvasNode } from "@/lib/canvas";
import { RATING_META } from "@/lib/rating";

/**
 * The cluster views' two extra node bodies. Deliberately NOT importing
 * @xyflow/react — `canvas-flow.tsx` stays the library's only importer; these
 * are plain components it registers as node types.
 */

const TYPE_ICON = { video: Film, image: ImageIcon, slides: Layers } as const;
type PlatformKey = keyof typeof PLATFORM_COLOR;

export interface ChipData {
  chip: CanvasChip;
  entity: CanvasNode;
  lens: CanvasLens;
}

/**
 * A CHIP is a PAIRING, not the entity in general: the border color is the
 * entity's status (the C1.5 language), but whether the border is SOLID or
 * DASHED — and whether the chip is dimmed — is the pairing's liveness. In the
 * cluster views there are no lines to dash, so the live / paused-here signal
 * lives here. Chips stay lean: no health count, no stars.
 *
 * In the RATE lens a paired chip gains a left stripe in its Rate colour and
 * shows the pairing's ROAS in place of its spend (an N/A pairing keeps its
 * spend — "not enough to judge" has no ratio worth printing). The stripe is a
 * solid fill, so the paused chip's dimming-by-parts is untouched.
 */
export const ChipNodeView = memo(function ChipNodeView({ data }: { data: ChipData }) {
  const { chip, entity, lens } = data;
  // A pairing chip, or (By angle) a WHOLE-creative chip with its own Rate.
  const paired = chip.edgeId !== null || chip.whole === true;
  const rated = lens === "rate" && paired;
  const state = chip.whole
    ? chip.live ? ", spending now" : ", stopped"
    : chip.edgeId ? (chip.live ? ", live here" : ", paused here") : ", idle";
  const borderColor =
    entity.kind === "campaign" ? CAMPAIGN_STATUS_DOT[entity.status] : STATUS_DOT[entity.status];
  const statusLabel =
    entity.kind === "campaign" ? CAMPAIGN_STATUS_LABEL[entity.status] : STATUS_LABEL[entity.status];
  const TypeIcon = entity.kind === "creative" ? TYPE_ICON[entity.type] : null;
  return (
    <div
      className={cn(
        "flex h-full w-full items-center gap-1.5 rounded-md border-2 px-2",
        // PAUSED HERE: dashed + dimmed. The edges dim by opacity alone (0.45),
        // but a chip carries TEXT: a flat 0.6 measured 2.9:1 on Frost/Paper,
        // and any wrapper opacity drags the dashed status border under 3:1
        // there. So the dimming is built from parts — the fill goes hollow
        // and the name steps down to ink-2 — which holds text ≥ 6.9:1 and
        // the border ≥ 3.5:1 on every theme (measured in the rig).
        chip.live ? "bg-surface" : "border-dashed bg-transparent",
      )}
      style={{ borderColor }}
      aria-label={`${entity.name} — ${statusLabel}${state}${rated ? `, rated ${RATING_META[chip.rate].label}` : ""}`}
    >
      {rated && (
        <span
          className="h-4 w-1 shrink-0 rounded-full"
          style={{ background: RATE_COLOR[chip.rate] }}
          aria-hidden
        />
      )}
      {entity.kind === "campaign" ? (
        <PlatformDot platform={entity.platform as PlatformKey} size="sm" />
      ) : (
        TypeIcon && <TypeIcon className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[11px]",
          chip.live ? "text-ink" : "text-ink-2",
          entity.kind === "creative" && "font-mono",
        )}
      >
        {entity.name}
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-ink-2">
        {!paired
          ? "idle"
          : rated && chip.rate !== "na"
            ? roas(chip.roas)
            : usdCompact(chip.spend)}
      </span>
    </div>
  );
});

export interface AngleHeaderData {
  angle: CanvasAngleHeader;
}

/**
 * An ANGLE's header (C8). Not an entity, so no status border and nothing to
 * open: name, the sums over its creatives, and how many are spending now.
 * A creative with several angles counts in each — the tooltip says so.
 */
export const AngleHeaderView = memo(function AngleHeaderView({ data }: { data: AngleHeaderData }) {
  const { angle } = data;
  const name = angle.name ?? "No angle";
  const overlap = "A creative with several angles counts in each, so angles don't add up to the brand total.";
  return (
    <div
      className="flex h-full w-full flex-col justify-center rounded-md border border-line-2 bg-surface px-2.5"
      title={overlap}
      aria-label={`Angle ${name}: ${angle.live} of ${angle.total} creatives spending now. ${overlap}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Lightbulb className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
        <span
          dir="auto"
          className={cn("truncate text-xs font-medium", angle.name ? "text-ink" : "text-ink-2 italic")}
        >
          {name}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-ink-2">
        <span className={cn("tabular-nums", angle.live === 0 && "text-warn")}>
          {angle.live}/{angle.total} live
        </span>
        <span className="ml-auto tabular-nums text-ink-2">{roas(angle.roas)}</span>
        <span className="shrink-0 text-xs tabular-nums text-ink">{usdCompact(angle.spend)}</span>
      </div>
    </div>
  );
});

export interface FrameData {
  kind: "campaign" | "creative" | "angle" | "idle";
  count: number;
}

/** The cluster's frame — a quiet tray behind its header and chips. The idle
 *  pseudo-cluster has no header node, so its frame carries a caption. */
export const ClusterFrameView = memo(function ClusterFrameView({ data }: { data: FrameData }) {
  return (
    <div className="h-full w-full rounded-lg border border-line bg-surface-2/40">
      {data.kind === "idle" && (
        <p className="text-label px-3 pt-3 text-ink-3">
          Idle creatives · {int(data.count)}
        </p>
      )}
    </div>
  );
});
