"use client";

import { memo } from "react";
import { Film, Image as ImageIcon, Layers } from "lucide-react";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PLATFORM_COLOR } from "@/lib/palette";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/creative-status";
import {
  CAMPAIGN_STATUS_DOT,
  CAMPAIGN_STATUS_LABEL,
} from "@/lib/campaign-status";
import { int, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CanvasChip, CanvasNode } from "@/lib/canvas";

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
}

/**
 * A CHIP is a PAIRING, not the entity in general: the border color is the
 * entity's status (the C1.5 language), but whether the border is SOLID or
 * DASHED — and whether the chip is dimmed — is the pairing's liveness. In the
 * cluster views there are no lines to dash, so the live / paused-here signal
 * lives here. Chips stay lean: no health count, no stars.
 */
export const ChipNodeView = memo(function ChipNodeView({ data }: { data: ChipData }) {
  const { chip, entity } = data;
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
      aria-label={`${entity.name} — ${statusLabel}${chip.edgeId ? (chip.live ? ", live here" : ", paused here") : ", idle"}`}
    >
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
      <span className="num shrink-0 text-[10px] tabular-nums text-ink-2">
        {chip.edgeId ? usdCompact(chip.spend) : "idle"}
      </span>
    </div>
  );
});

export interface FrameData {
  kind: "campaign" | "creative" | "idle";
  count: number;
}

/** The cluster's frame — a quiet tray behind its header and chips. The idle
 *  pseudo-cluster has no header node, so its frame carries a caption. */
export const ClusterFrameView = memo(function ClusterFrameView({ data }: { data: FrameData }) {
  return (
    <div className="h-full w-full rounded-xl border border-line bg-surface-2/40">
      {data.kind === "idle" && (
        <p className="text-label px-3 pt-3 text-ink-3">
          Idle creatives · {int(data.count)}
        </p>
      )}
    </div>
  );
});
