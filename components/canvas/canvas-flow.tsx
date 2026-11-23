"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleHelp, Film, Image as ImageIcon, Layers, Search, X } from "lucide-react";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PriorityStars } from "@/components/creative/priority-stars";
import { PLATFORM_COLOR, PLATFORM_LABEL, RATE_COLOR } from "@/lib/palette";
import { RATING_META, RATING_VALUES, type Rating, type RatingRules } from "@/lib/rating";
import {
  CREATIVE_STATUSES,
  STATUS_DOT,
  STATUS_LABEL,
} from "@/lib/creative-status";
import {
  CAMPAIGN_STATUS_DOT,
  CAMPAIGN_STATUS_LABEL,
} from "@/lib/campaign-status";
import { int, longDate, pct1, roas, usd, usd0, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AngleHeaderView,
  ChipNodeView,
  ClusterFrameView,
  type ChipData,
} from "@/components/canvas/cluster-nodes";
import {
  ANGLE_HEADER_HEIGHT,
  ANGLE_HEADER_WIDTH,
  CANVAS_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  canvasLevelNoun,
  canvasNodeSizes,
  isAngleHeaderId,
  clusterBoxes,
  clusterColumnsFor,
  clusterFocus,
  clusterFrameId,
  clusterHeaderId,
  creativeSide,
  edgeWidth,
  focusFor,
  tripartiteBoxes,
  type CanvasCluster,
  type CanvasLevel,
  type CanvasSide,
  type CanvasViewMode,
  type CanvasLens,
  type CanvasCampaignNode,
  type CanvasCreativeNode,
  type CanvasGraph,
  type CanvasNode,
} from "@/lib/canvas";
import { Chip } from "@/components/ui/chip";
import { LaunchedTag } from "@/components/canvas/launched-tag";
import { AD_NETWORK_LABEL, isAdNetwork } from "@/lib/campaign";

/**
 * The Network view: campaigns left, creatives right, an edge wherever a
 * creative SPENT inside a campaign in the range. Every tool here is a VIEWING
 * tool — nodes aren't draggable (these are facts, not a whiteboard), nothing
 * connects, nothing is saved.
 *
 * This module is the ONLY importer of @xyflow/react, and the page loads it
 * with `next/dynamic` — so the library ships on /canvas and nowhere else.
 */

export interface CanvasFocusRequest {
  /**
   * The primary ENTITY ids (campaign / creative node ids) — never occurrence
   * ids. That is what lets one focus mean the same thing in all three views,
   * and survive a switch between them.
   */
  ids: string[];
  /**
   * Where to take the viewport: `"all"` frames everything lit (insight
   * chips), `"first"` pans to the first occurrence (search — in a cluster
   * view an entity can be lit in many places), `"none"` leaves it (a click).
   */
  fit: "none" | "all" | "first";
  /**
   * Open the CLICK INSPECTOR for `ids[0]`: a node click and a search pick set
   * it; an insight chip (a group focus) doesn't.
   */
  inspect?: boolean;
}

type PlatformKey = keyof typeof PLATFORM_COLOR;
const platformColor = (p: string) =>
  PLATFORM_COLOR[p as PlatformKey] ?? "var(--ink-3)";
/** "Meta · " for a campaign's network; nothing when it isn't known. */
const networkLabel = (network: string | null) =>
  network && isAdNetwork(network) ? `${AD_NETWORK_LABEL[network]} · ` : "";

const TYPE_ICON = { video: Film, image: ImageIcon, slides: Layers } as const;

/** `scale` is the box's size factor (spend); `side` is a creative's flank. */
type FlowNode = Node<{ node: CanvasNode; scale: number; side: CanvasSide | null }>;
/**
 * Any node on the canvas. `entityId` is the campaign/creative a node STANDS
 * FOR — itself in the network view, the header's or chip's entity in a cluster
 * view, null for a cluster frame. Clicks, hover and double-click all speak in
 * entity ids.
 */
type AnyNode = Node<Record<string, unknown> & { entityId: string | null }>;

// ── Nodes ────────────────────────────────────────────────────────────────────
// Tokens only, so all four themes hold. Handles exist because edges need
// anchors; they are invisible and inert (nothing connects on this page), and
// they sit on the node ROOT — outside the scaled body — so an edge always
// leaves from the true box edge however big the node is drawn.
const HANDLE = "!h-1 !w-1 !min-w-0 !border-0 !bg-transparent !opacity-0";
// STATUS BORDER is the headline signal: 2px in the status color. The status
// WORD rides inside as well — a second color-coded dot would tell a
// colorblind reader nothing the border hadn't already failed to.
const SHELL = "rounded-lg border-2 bg-surface px-3 py-2 shadow-sm";

/**
 * The node body is laid out ONCE at the base size and scaled as a whole, so
 * size-by-spend grows the box and its type together and reads as one signal.
 */
function Body({
  scale,
  borderColor,
  className,
  children,
}: {
  scale: number;
  borderColor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(SHELL, className)}
      style={{
        width: CANVAS_NODE_WIDTH,
        height: CANVAS_NODE_HEIGHT,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        borderColor,
      }}
    >
      {children}
    </div>
  );
}

const CampaignNodeView = memo(function CampaignNodeView({
  data,
}: NodeProps<FlowNode>) {
  const n = data.node as CanvasCampaignNode;
  return (
    <>
      {/* Left flank feeds IN; the right flank is fed from OUT. */}
      <Handle id="in" type="target" position={Position.Left} className={HANDLE} isConnectable={false} />
      <Body scale={data.scale} borderColor={CAMPAIGN_STATUS_DOT[n.status]}>
        <div className="flex items-center gap-1.5">
          <PlatformDot platform={n.platform as PlatformKey} size="sm" />
          <span className="truncate text-xs font-medium text-ink" title={n.name}>
            {n.name}
          </span>
          <LaunchedTag on={n.launchedOn} />
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          {/* An ad set carries ONE objective; a campaign's ad sets may carry
              several, so its chip says WHERE it runs and how many it has —
              the network is also what tells two same-named campaigns apart. */}
          <Chip
            className="min-w-0 shrink"
            title={n.level === "campaign" ? `Registered ad sets · ${n.objective}` : undefined}
          >
            <span className="truncate tabular-nums">
              {n.level === "campaign"
                ? `${networkLabel(n.network)}${int(n.adSets)} ad set${n.adSets === 1 ? "" : "s"}`
                : n.objective}
            </span>
          </Chip>
          <span className="shrink-0 text-[10px] text-ink-2">
            {CAMPAIGN_STATUS_LABEL[n.status]}
          </span>
          <span
            className={cn(
              "shrink-0 text-[10px] tabular-nums",
              n.liveChildren === 0 ? "text-warn" : "text-ink-2",
            )}
            title={`${n.liveChildren} of ${n.totalChildren} creatives currently spending here`}
            aria-label={`${n.liveChildren} of ${n.totalChildren} creatives currently spending here`}
          >
            {n.liveChildren}/{n.totalChildren}
          </span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-ink">
            {usdCompact(n.spend)}
          </span>
        </div>
      </Body>
      <Handle id="out" type="source" position={Position.Right} className={HANDLE} isConnectable={false} />
    </>
  );
});

const CreativeNodeView = memo(function CreativeNodeView({
  data,
}: NodeProps<FlowNode>) {
  const n = data.node as CanvasCreativeNode;
  const TypeIcon = TYPE_ICON[n.type];
  // The one handle faces the center: a LEFT-flank creative is an edge's
  // source (its right side), a RIGHT-flank one its target (its left side).
  const onLeft = data.side === "left";
  return (
    <>
      {!onLeft && (
        <Handle type="target" position={Position.Left} className={HANDLE} isConnectable={false} />
      )}
      <Body
        scale={data.scale}
        borderColor={STATUS_DOT[n.status]}
        className="flex items-center gap-2"
      >
        {n.thumbnailUrl && (
          // A background, not an <img>: a broken or slow thumbnail can't reflow
          // the node, and the canvas never waits on it.
          <span
            className="h-9 w-9 shrink-0 rounded-sm border border-line bg-surface-2 bg-cover bg-center"
            style={{ backgroundImage: `url("${n.thumbnailUrl}")` }}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TypeIcon className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
            <span dir="auto" className="truncate font-mono text-[11px] text-ink" title={n.name}>
              {n.name}
            </span>
            <LaunchedTag on={n.launchedOn} />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] text-ink-2">{STATUS_LABEL[n.status]}</span>
            <PriorityStars value={n.priority} className="origin-left scale-90" />
            <span className="ml-auto shrink-0 text-xs tabular-nums text-ink">
              {n.spend > 0 ? usdCompact(n.spend) : "idle"}
            </span>
          </div>
        </div>
      </Body>
      {onLeft && (
        <Handle type="source" position={Position.Right} className={HANDLE} isConnectable={false} />
      )}
    </>
  );
});

const NODE_TYPES = {
  campaign: CampaignNodeView,
  creative: CreativeNodeView,
  chip: ChipNodeView,
  frame: ClusterFrameView,
  angle: AngleHeaderView,
} as unknown as NodeTypes;

/** React Flow's chrome, re-pointed at the app's tokens — so the canvas, the
 *  minimap and the controls follow whichever of the four themes is active. */
const FLOW_THEME = {
  "--xy-background-color": "var(--background)",
  "--xy-background-pattern-dots-color": "var(--line)",
  "--xy-edge-stroke": "var(--line-2)",
  "--xy-minimap-background-color": "var(--surface)",
  "--xy-minimap-mask-background-color":
    "color-mix(in srgb, var(--background) 70%, transparent)",
  "--xy-minimap-mask-stroke-color": "var(--line-2)",
  "--xy-minimap-node-stroke-color": "transparent",
  "--xy-controls-button-background-color": "var(--surface)",
  "--xy-controls-button-background-color-hover": "var(--surface-2)",
  "--xy-controls-button-color": "var(--ink-2)",
  "--xy-controls-button-color-hover": "var(--ink)",
  "--xy-controls-button-border-color": "var(--line)",
  "--xy-controls-box-shadow": "none",
  "--xy-attribution-background-color": "transparent",
} as React.CSSProperties;

/**
 * The pairing's performance, in both lenses: its ROAS and its Rate (a swatch
 * in the Rate colour + the word, so the colour is never the only carrier).
 */
/**
 * A pairing that ran on MORE than one platform (a Meta campaign on Instagram
 * and Facebook) names them — its line can only carry one colour. A pairing on
 * one platform says nothing: the colour already did.
 */
function PlatformsLine({ platforms }: { platforms: readonly string[] }) {
  if (platforms.length < 2) return null;
  return (
    <p className="mt-0.5 text-[11px] text-ink-3">
      {platforms.map((p) => PLATFORM_LABEL[p as PlatformKey] ?? p).join(" + ")}
    </p>
  );
}

function RateLine({ value, rate }: { value: number | null; rate: Rating }) {
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
      ROAS <span className="tabular-nums text-ink">{roas(value)}</span>
      <span aria-hidden>·</span>
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: RATE_COLOR[rate] }}
        aria-hidden
      />
      <span className="text-ink-2">
        {rate === "na" ? "N/A — not enough spend to judge" : RATING_META[rate].label}
      </span>
    </p>
  );
}

interface Tip {
  x: number;
  y: number;
  body: React.ReactNode;
}

function Flow({
  graph,
  view,
  lens,
  rateRules,
  clusters,
  focus,
  onFocus,
  onOpen,
  reservedWidth = 0,
  coveredBottom = 0,
}: {
  graph: CanvasGraph;
  view: CanvasViewMode;
  /** What a line (network) or a chip's stripe (clusters) is coloured by. */
  lens: CanvasLens;
  /** The brand's default Rate rules — the legend's thresholds. */
  rateRules: RatingRules;
  /** The cluster model for the two tree views (empty in the network view). */
  clusters: readonly CanvasCluster[];
  focus: CanvasFocusRequest | null;
  onFocus: (req: CanvasFocusRequest | null) => void;
  /** Double-click — the page decides where an entity's detail lives. */
  onOpen: (node: CanvasNode) => void;
  /**
   * Width the inspector column is taking from the pane right now (desktop).
   * The cluster views count columns as if it weren't there, so opening the
   * inspector never re-flows the clusters or re-fits the viewport.
   */
  reservedWidth?: number;
  /**
   * Fraction of the pane's height the inspector OVERLAY covers on a phone
   * (0 when it's a column). Keep-in-view centres the node in what's left.
   */
  coveredBottom?: number;
}) {
  const flow = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of graph.campaigns) m.set(n.id, n);
    for (const n of graph.creatives) m.set(n.id, n);
    return m;
  }, [graph]);

  const boxes = useMemo(() => tripartiteBoxes(graph), [graph]);
  // HOVER PRE-FOCUS: a lighter preview of click-focus. It never fights a real
  // focus — while one is active the hover id is simply ignored.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const maxEdgeSpend = useMemo(
    () => graph.edges.reduce((m, e) => Math.max(m, e.spend), 0),
    [graph],
  );
  // Lit sets are FLOW-node ids. The network reads them off the edges; a
  // cluster view maps the same entity ids onto every occurrence.
  const litFor = useCallback(
    (ids: readonly string[]) => {
      if (view === "network") {
        const f = focusFor(ids, graph.edges);
        return { nodes: f.nodes, edges: f.edges, first: ids[0] ?? null };
      }
      const f = clusterFocus(ids, clusters);
      return { nodes: f.lit, edges: new Set<string>(), first: f.first };
    },
    [view, graph, clusters],
  );
  const lit = useMemo(() => (focus ? litFor(focus.ids) : null), [focus, litFor]);
  const preview = useMemo(
    () => (!focus && hoverId ? litFor([hoverId]) : null),
    [focus, hoverId, litFor],
  );

  // Cluster layout: the column count follows the PANE (one on a phone), and
  // headers are the same spend-scaled size the network draws.
  const paneWidth = useStore((st) => st.width);
  const columns = clusterColumnsFor(paneWidth + reservedWidth);
  const clusterLayout = useMemo(
    () => {
      if (view === "network") return null;
      const entitySize = canvasNodeSizes(graph);
      return clusterBoxes(clusters, columns, (id) =>
        isAngleHeaderId(id) ? { width: ANGLE_HEADER_WIDTH, height: ANGLE_HEADER_HEIGHT } : entitySize(id),
      );
    },
    [view, clusters, columns, graph],
  );

  const dim = useCallback(
    (id: string) =>
      // Click-focus dims the rest to 15%; the hover preview only to 70%.
      lit ? (lit.nodes.has(id) ? 1 : 0.15) : preview ? (preview.nodes.has(id) ? 1 : 0.7) : 1,
    [lit, preview],
  );

  const clusterNodes: AnyNode[] = useMemo(() => {
    if (!clusterLayout) return [];
    const out: AnyNode[] = [];
    const sized = (box: { x: number; y: number; width: number; height: number }) => ({
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      measured: { width: box.width, height: box.height },
    });
    for (const c of clusters) {
      const frame = clusterLayout.frames.get(c.id);
      if (!frame) continue;
      const frameId = clusterFrameId(c.id);
      out.push({
        id: frameId,
        type: "frame",
        ...sized(frame),
        zIndex: 0,
        data: { entityId: null, kind: c.kind, count: c.chips.length },
        // The frame is scenery: clicks fall through to the pane (so an empty
        // click inside a cluster still clears focus).
        style: { opacity: dim(frameId), transition: "opacity 120ms", pointerEvents: "none" },
      });
      const headerBox = clusterLayout.headers.get(c.id);
      if (headerBox && c.angle) {
        const id = clusterHeaderId(c.id);
        out.push({
          id,
          type: "angle",
          ...sized(headerBox),
          zIndex: 1,
          // entityId = the angle's `a:` id: a click focuses it (lighting the
          // whole cluster), and nothing opens — an angle has no page here.
          data: { entityId: c.angle.id, angle: c.angle },
          style: { opacity: dim(id), transition: "opacity 120ms" },
        });
      }
      const header = c.headerId ? byId.get(c.headerId) : undefined;
      if (headerBox && header) {
        const id = clusterHeaderId(c.id);
        out.push({
          id,
          type: header.kind,
          ...sized(headerBox),
          zIndex: 1,
          data: {
            entityId: header.id,
            node: header,
            scale: headerBox.width / CANVAS_NODE_WIDTH,
            side: null,
          },
          style: { opacity: dim(id), transition: "opacity 120ms" },
        });
      }
      for (const chip of c.chips) {
        const box = clusterLayout.chips.get(chip.id);
        const entity = byId.get(chip.entityId);
        if (!box || !entity) continue;
        out.push({
          id: chip.id,
          type: "chip",
          ...sized(box),
          zIndex: 1,
          data: { entityId: entity.id, chip, entity, lens } satisfies ChipData & { entityId: string },
          style: { opacity: dim(chip.id), transition: "opacity 120ms" },
        });
      }
    }
    return out;
  }, [clusterLayout, clusters, byId, dim, lens]);

  const networkNodes: AnyNode[] = useMemo(
    () =>
      view !== "network"
        ? []
        : [...graph.campaigns, ...graph.creatives].map((n) => {
        const box = boxes.get(n.id) ?? {
          x: 0,
          y: 0,
          width: CANVAS_NODE_WIDTH,
          height: CANVAS_NODE_HEIGHT,
        };
        return {
          id: n.id,
          type: n.kind,
          position: { x: box.x, y: box.y },
          // SIZE BY SPEND, and known up front. `measured` is supplied too: this
          // list is rebuilt on every focus change and culled off-screen
          // (`onlyRenderVisibleElements`), so React Flow would otherwise have
          // no measured size for most nodes — and `fitView({ nodes })`
          // silently ignores any node without one.
          width: box.width,
          height: box.height,
          measured: { width: box.width, height: box.height },
          data: {
            entityId: n.id,
            node: n,
            scale: box.width / CANVAS_NODE_WIDTH,
            side: n.kind === "creative" ? creativeSide(n.type) : null,
          },
          style: { opacity: dim(n.id), transition: "opacity 120ms" },
        };
      }),
    [view, graph, boxes, dim],
  );
  const nodes = view === "network" ? networkNodes : clusterNodes;

  const creativeById = useMemo(
    () => new Map(graph.creatives.map((c) => [c.id, c])),
    [graph],
  );

  const edges: Edge[] = useMemo(
    () =>
      // The cluster views have NO lines — the pairing's state rides on the chip.
      (view === "network" ? graph.edges : []).map((e) => {
        // Edges route left → center and center → right, so a LEFT-flank
        // creative is the source and the campaign its target.
        const creative = creativeById.get(e.target);
        const onLeft = creative ? creativeSide(creative.type) === "left" : false;
        // LIVE: solid, full color. PAUSED HERE: dashed and dimmed. The LENS
        // picks the color only — platform, or the pairing's Rate; width, dash
        // and opacity mean the same in both.
        // A live RATE line draws at full strength: at 0.85 the Good / Decent /
        // N/A tokens measured 2.7–3.0:1 on Frost and Paper; at 1 every Rate
        // colour clears 3.4:1 on all four themes (measured in the app).
        const base = e.live ? (lens === "rate" ? 1 : 0.85) : 0.45;
        const strong = e.live ? 1 : 0.65;
        const opacity = lit
          ? lit.edges.has(e.id) ? strong : 0.06
          : preview
            ? preview.edges.has(e.id) ? strong : base * 0.7
            : base;
        return {
          id: e.id,
          ...(onLeft
            ? { source: e.target, target: e.source, targetHandle: "in" }
            : { source: e.source, sourceHandle: "out", target: e.target }),
          // Wide enough to hover without pixel-hunting a 1px line.
          interactionWidth: 14,
          style: {
            stroke: lens === "rate" ? RATE_COLOR[e.rate] : platformColor(e.platform),
            strokeWidth: edgeWidth(e.spend, maxEdgeSpend),
            strokeDasharray: e.live ? undefined : "6 5",
            opacity,
            transition: "opacity 120ms",
          },
        };
      }),
    [view, lens, graph, creativeById, maxEdgeSpend, lit, preview],
  );

  // THE INITIAL FIT, done by hand. React Flow's own `fitView` prop resolves
  // the moment every node has dimensions — and ours are supplied up front
  // (`measured`), so it fired before the pane had been measured (store width
  // 0) and framed the graph against nothing. Fit once the pane has a real
  // size, and again whenever the graph itself changes (a filter round-trip).
  // PER VIEW: the network frames the whole graph; a cluster view frames its
  // TOP TWO ROWS — order is spend desc, so that is the story, and a long board
  // fitted whole would shrink every chip to nothing (pan or the minimap for
  // the rest). Re-runs on a view switch and when the column count changes.
  const paneReady = useStore((st) => st.width > 0 && st.height > 0);
  useEffect(() => {
    if (!paneReady) return;
    if (!clusterLayout) {
      void flow.fitView({ padding: 0.15 });
      return;
    }
    const top = clusterLayout.rows.slice(0, 2).flat();
    if (top.length === 0) return;
    void flow.fitView({
      nodes: top.map((id) => ({ id: clusterFrameId(id) })),
      padding: 0.1,
      maxZoom: 1.1,
    });
  }, [paneReady, graph, clusterLayout, flow]);

  // KEEP THE INSPECTED NODE IN VIEW. Opening the inspector column narrows the
  // pane from the right, so a node clicked near that edge would vanish behind
  // the panel it just opened. Once the pane has its new width, pan — at the
  // same zoom, and only if the node is actually out of view — to bring the
  // first lit occurrence back.
  const paneHeight = useStore((st) => st.height);
  const keepInView = useCallback(
    (id: string) => {
      if (paneWidth === 0) return;
      const n = flow.getInternalNode(id);
      if (!n) return;
      const { x: vx, y: vy, zoom } = flow.getViewport();
      const w = n.measured.width ?? n.width ?? 0;
      const h = n.measured.height ?? n.height ?? 0;
      const left = n.internals.positionAbsolute.x * zoom + vx;
      const top = n.internals.positionAbsolute.y * zoom + vy;
      const visibleHeight = paneHeight * (1 - coveredBottom);
      const inView =
        left >= 0 && left + w * zoom <= paneWidth && top >= 0 && top + h * zoom <= visibleHeight;
      if (inView) return;
      // setCenter centres in the WHOLE pane; push the target down by half the
      // covered strip so the node lands in the middle of the visible part.
      void flow.setCenter(
        n.internals.positionAbsolute.x + w / 2,
        n.internals.positionAbsolute.y + h / 2 + (paneHeight * coveredBottom) / 2 / zoom,
        { zoom, duration: 300 },
      );
    },
    [flow, paneWidth, paneHeight, coveredBottom],
  );
  useEffect(() => {
    if (!focus?.inspect || focus.fit !== "none" || !lit?.first) return;
    keepInView(lit.first);
  }, [focus, lit, keepInView]);

  // Take the viewport where the focus request asks: everything lit (insight
  // chips) or just the first occurrence (search, a pairing row, a link). That
  // pan centres in the WHOLE pane — under the phone's inspector overlay — so
  // an inspected node gets the keep-in-view step once it lands.
  useEffect(() => {
    if (!focus || focus.fit === "none" || !lit) return;
    const ids = focus.fit === "first" ? (lit.first ? [lit.first] : []) : [...lit.nodes];
    if (ids.length === 0) return;
    const first = lit.first;
    void flow
      .fitView({
        nodes: ids.map((id) => ({ id })),
        padding: focus.fit === "first" ? 1.2 : 0.25,
        duration: 400,
        maxZoom: 1.1,
      })
      .then(() => {
        if (focus.inspect && focus.fit === "first" && first) keepInView(first);
      });
    // keepInView is deliberately NOT a dependency: a pane resize must not
    // re-run this fit — the effect above covers resizes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, lit, flow]);

  // ESC clears focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onFocus(null);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFocus]);

  const at = useCallback((e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }, []);

  const nodeTip = useCallback(
    (e: React.MouseEvent, fn: AnyNode) => {
      if (fn.type === "chip") {
        // A chip is a PAIRING: its tooltip is the edge's, not the entity's.
        const { chip, entity } = fn.data as unknown as ChipData;
        if (chip.whole) {
          // By angle: the WHOLE creative, across every campaign it ran in.
          setTip({
            ...at(e),
            body: (
              <>
                <p className="max-w-[16rem] truncate text-xs font-medium text-ink">{entity.name}</p>
                <p className="mt-0.5 text-[11px] text-ink-2">
                  <span className="text-ink">{chip.live ? "spending now" : "stopped"}</span>
                  {" · "}
                  <span className="tabular-nums text-ink">{usd(chip.spend)}</span> in all{" "}
                  {canvasLevelNoun(graph.level, 2)}
                </p>
                <RateLine value={chip.roas} rate={chip.rate} />
                <p className="mt-1 text-[10px] text-ink-2">Double-click to open</p>
              </>
            ),
          });
          return;
        }
        const edge = chip.edgeId ? graph.edges.find((x) => x.id === chip.edgeId) : undefined;
        const camp = edge ? byId.get(edge.source) : undefined;
        const share = edge && camp && camp.spend > 0 ? edge.spend / camp.spend : null;
        setTip({
          ...at(e),
          body: (
            <>
              <p className="max-w-[16rem] truncate text-xs font-medium text-ink">{entity.name}</p>
              {edge ? (
                <>
                  <p className="mt-0.5 text-[11px] text-ink-2">
                    {edge.live ? (
                      <span className="text-ink">live here</span>
                    ) : (
                      <>
                        <span className="text-ink">paused here</span>
                        {edge.lastSpendDay && <> since {longDate(edge.lastSpendDay)}</>}
                      </>
                    )}
                    {" · "}
                    <span className="tabular-nums text-ink">{usd(edge.spend)}</span>
                  </p>
                  <p className="mt-0.5 max-w-[16rem] text-[11px] text-ink-3">
                    {share === null ? "—" : pct1(share)} of{" "}
                    <span className="text-ink-2">{camp?.name ?? `the ${canvasLevelNoun(graph.level)}`}</span>
                    &rsquo;s spend
                  </p>
                  <PlatformsLine platforms={edge.platforms} />
                  <RateLine value={edge.roas} rate={edge.rate} />
                </>
              ) : (
                <p className="mt-0.5 text-[11px] text-ink-3">
                  Active, but no spend in this range.
                </p>
              )}
              <p className="mt-1 text-[10px] text-ink-2">Double-click to open</p>
            </>
          ),
        });
        return;
      }
      const n = (fn as unknown as FlowNode).data.node;
      if (!n) return;
      setTip({
        ...at(e),
        body: (
          <>
            <p className="max-w-[16rem] truncate text-xs font-medium text-ink">{n.name}</p>
            <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[11px]">
              <dt className="text-ink-3">Spend</dt>
              <dd className="text-right tabular-nums text-ink">{usd(n.spend)}</dd>
              <dt className="text-ink-3">Conversions</dt>
              <dd className="text-right tabular-nums text-ink">{int(n.conversions)}</dd>
              <dt className="text-ink-3">ROAS</dt>
              <dd className="text-right tabular-nums text-ink">
                {roas(n.spend > 0 ? n.revenue / n.spend : null)}
              </dd>
            </dl>
            <p className="mt-1 text-[10px] text-ink-2">Double-click to open</p>
          </>
        ),
      });
    },
    [at, graph, byId],
  );

  const edgeTip = useCallback(
    (e: React.MouseEvent, fe: Edge) => {
      const edge = graph.edges.find((x) => x.id === fe.id);
      if (!edge) return;
      const camp = byId.get(edge.source);
      const share = camp && camp.spend > 0 ? edge.spend / camp.spend : null;
      setTip({
        ...at(e),
        body: (
          <>
            <p className="text-[11px] text-ink-2">
              {edge.live ? (
                <span className="text-ink">live</span>
              ) : (
                <>
                  <span className="text-ink">paused here</span>
                  {edge.lastSpendDay && <> since {longDate(edge.lastSpendDay)}</>}
                </>
              )}
              {" · "}
              <span className="tabular-nums text-ink">{usd(edge.spend)}</span>
            </p>
            <p className="mt-0.5 max-w-[16rem] text-[11px] text-ink-3">
              {share === null ? "—" : pct1(share)} of{" "}
              <span className="text-ink-2">{camp?.name ?? `the ${canvasLevelNoun(graph.level)}`}</span>
              &rsquo;s spend
            </p>
            <PlatformsLine platforms={edge.platforms} />
            <RateLine value={edge.roas} rate={edge.rate} />
          </>
        ),
      });
    },
    [graph, byId, at],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: CanvasNode[] = [];
    for (const n of byId.values()) {
      if (n.name.toLowerCase().includes(q)) out.push(n);
      if (out.length >= 8) break;
    }
    return out;
  }, [query, byId]);

  const jumpTo = (n: CanvasNode) => {
    setQuery("");
    // In a cluster view this lights EVERY occurrence and pans to the first.
    onFocus({ ids: [n.id], fit: "first", inspect: true });
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        style={FLOW_THEME}
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.05}
        maxZoom={2}
        // Facts, not a whiteboard: nothing drags, connects or selects.
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        onlyRenderVisibleElements
        onNodeClick={(_, n) => {
          const id = (n as AnyNode).data.entityId;
          // An angle header lights its creatives; it has no details panel.
          if (id) onFocus({ ids: [id], fit: "none", inspect: !isAngleHeaderId(id) });
        }}
        onNodeDoubleClick={(_, n) => {
          const entity = byId.get((n as AnyNode).data.entityId ?? "");
          if (entity) onOpen(entity);
        }}
        onPaneClick={() => onFocus(null)}
        onNodeMouseEnter={(e, n) => {
          setHoverId((n as AnyNode).data.entityId);
          nodeTip(e, n as AnyNode);
        }}
        onNodeMouseMove={(e, n) => nodeTip(e, n as AnyNode)}
        onNodeMouseLeave={() => {
          setHoverId(null);
          setTip(null);
        }}
        onEdgeMouseEnter={edgeTip}
        onEdgeMouseMove={edgeTip}
        onEdgeMouseLeave={() => setTip(null)}
        onMoveStart={() => setTip(null)}
      >
        <Background gap={24} size={1} />
        {/* Four corners, one job each: search · zoom · legend · minimap. The
            legend takes bottom-left, so the zoom controls moved up; nothing
            sits over React Flow's attribution (bottom-right, under the map). */}
        <Controls showInteractive={false} position="top-right" />
        <Panel position="bottom-left">
          <Legend view={view} lens={lens} level={graph.level} rateRules={rateRules} />
        </Panel>
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="!hidden rounded-lg border border-line sm:!block"
          nodeColor={(n) => {
            if (n.type === "frame") return "transparent";
            const d = (n as AnyNode).data as { node?: CanvasNode; entity?: CanvasNode };
            const node = d.node ?? d.entity;
            return node?.kind === "campaign" ? platformColor(node.platform) : "var(--ink-3)";
          }}
          nodeBorderRadius={4}
        />

        <Panel position="top-left">
          <div className="relative w-56 max-w-[60vw]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) jumpTo(matches[0]);
              }}
              placeholder={
                graph.level === "campaign" ? "Find a campaign or creative…" : "Find an ad set or creative…"
              }
              aria-label="Find a node"
              className="h-8 w-full rounded-md border border-line bg-surface pl-7 pr-2 text-xs text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
            />
            {matches.length > 0 && (
              <ul className="absolute left-0 right-0 top-9 z-10 overflow-hidden rounded-md border border-line bg-popover shadow-lg">
                {matches.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(n)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                    >
                      <span className="text-eyebrow shrink-0 text-ink-3">
                        {n.kind === "campaign" ? (n.level === "campaign" ? "Camp" : "Ad set") : "Crtv"}
                      </span>
                      <span className="truncate">{n.name}</span>
                      {/* Two campaigns may share a name across networks. */}
                      {n.kind === "campaign" && n.level === "campaign" && n.network && isAdNetwork(n.network) && (
                        <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                          {AD_NETWORK_LABEL[n.network]}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </ReactFlow>

      {tip && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-line bg-popover px-2.5 py-2 shadow-lg"
          style={{
            left: tip.x + 14,
            top: tip.y + 14,
          }}
        >
          {tip.body}
        </div>
      )}
    </div>
  );
}

const LEGEND_KEY = "cw-canvas-legend";

/** A Rate threshold as the admin typed it — "4×", "2.5×", never "4.00×". */
const threshold = (x: number) => `${Number(x.toFixed(2))}×`;

/**
 * The legend — every encoding on the canvas, in one place. Collapsed to a "?"
 * chip by default (the canvas is the point; the key is for the first visit
 * and the occasional doubt) and remembered per browser. Tokens only.
 */
function Legend({
  view,
  lens,
  level,
  rateRules,
}: {
  view: CanvasViewMode;
  lens: CanvasLens;
  level: CanvasLevel;
  rateRules: RatingRules;
}) {
  const nouns = canvasLevelNoun(level, 2);
  const [open, setOpen] = useState(false);
  const paneHeight = useStore((st) => st.height);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(LEGEND_KEY) === "open");
    } catch {
      /* storage unavailable — stay collapsed */
    }
  }, []);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      if (next) localStorage.setItem(LEGEND_KEY, "open");
      else localStorage.removeItem(LEGEND_KEY);
    } catch {
      /* ignore */
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        aria-label="Show the legend"
        title="Legend"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
    );
  }

  const swatch = "h-3 w-5 shrink-0 rounded-sm border-2 bg-surface";
  return (
    // Capped to the pane (minus the search box above it) so a tall legend —
    // the Rate lens adds a block — scrolls instead of sliding under search.
    <div
      className="w-56 overflow-y-auto overflow-x-hidden rounded-lg border border-line bg-surface p-3 text-[11px] text-ink-2 shadow-lg"
      style={{ maxHeight: paneHeight > 0 ? Math.max(160, paneHeight - 72) : undefined }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-label text-ink-3">Legend</span>
        <button
          type="button"
          onClick={() => toggle(false)}
          aria-label="Hide the legend"
          className="text-ink-3 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-1 text-ink-3">Border — status</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {CREATIVE_STATUSES.map((st) => (
          <li key={st} className="flex items-center gap-1.5">
            <span className={swatch} style={{ borderColor: STATUS_DOT[st] }} />
            {STATUS_LABEL[st]}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] text-ink-2">
        {level === "campaign" ? "Campaigns" : "Ad sets"}: {CAMPAIGN_STATUS_LABEL.active} /{" "}
        {CAMPAIGN_STATUS_LABEL.inactive}, same colors. “3/5” = creatives currently spending
        there.
        {level === "campaign" && " A campaign is active when any of its ad sets is."}
      </p>

      {view !== "network" && (
        // The one extra line the cluster views need: there are no lines to
        // dash, so the pairing's state moves ONTO the duplicated chip.
        <>
          <p className="mb-1 mt-2.5 text-ink-3">
            {view === "angle"
              ? `Chip — the whole creative, across its ${nouns}`
              : `Chip — a pairing, not the whole ${view === "campaign" ? "creative" : canvasLevelNoun(level)}`}
          </p>
          <ul className="space-y-1">
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-5 shrink-0 rounded-sm border-2 bg-surface" style={{ borderColor: "var(--ink-2)" }} />
              {view === "angle" ? "Solid — spending now" : "Solid — live here"}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-5 shrink-0 rounded-sm border-2 border-dashed bg-transparent" style={{ borderColor: "var(--ink-2)" }} />
              {view === "angle"
                ? "Dashed + dimmed — stopped everywhere"
                : <>Dashed + dimmed — paused here (the network&rsquo;s dashed line)</>}
            </li>
          </ul>
        </>
      )}

      {view === "network" && (
      <>
      <p className="mb-1 mt-2.5 text-ink-3">Line — is it spending here now?</p>
      <ul className="space-y-1">
        <li className="flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden className="shrink-0">
            <line x1="0" y1="3" x2="20" y2="3" stroke="var(--ink-2)" strokeWidth="2" />
          </svg>
          Live — spent inside the status window
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden className="shrink-0">
            <line x1="0" y1="3" x2="20" y2="3" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 4" opacity="0.6" />
          </svg>
          Paused here — in the range, not the window
        </li>
      </ul>
      </>
      )}

      {lens === "rate" && (
        // The Rate lens: the same verdict, thresholds and min spend as the
        // Summary's Rate column. The brand DEFAULT is printed; a platform may
        // override it, so the footnote says where the rules live.
        <>
          <p className="mb-1 mt-2.5 text-ink-3">
            {view === "network" ? "Line color" : "Stripe"} — Rate of the pairing
          </p>
          <ul className="grid grid-cols-2 gap-x-2 gap-y-1">
            {RATING_VALUES.map((r) => (
              <li key={r} className="flex items-center gap-1.5">
                {view === "network" ? (
                  <svg width="20" height="6" aria-hidden className="shrink-0">
                    <line x1="0" y1="3" x2="20" y2="3" stroke={RATE_COLOR[r]} strokeWidth="3" />
                  </svg>
                ) : (
                  <span
                    className="h-3 w-1 shrink-0 rounded-full"
                    style={{ background: RATE_COLOR[r] }}
                    aria-hidden
                  />
                )}
                {RATING_META[r].label}
                <span className="tabular-nums text-ink-3">
                  {r === "good"
                    ? `≥${threshold(rateRules.goodRoas)}`
                    : r === "decent"
                      ? `≥${threshold(rateRules.decentRoas)}`
                      : r === "bad"
                        ? `<${threshold(rateRules.decentRoas)}`
                        : `<${usd0(rateRules.minSpend)}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-ink-2">
            ROAS over the range; N/A = under the min spend. Brand defaults — a
            platform can override them (Configuration › Rate rules).
          </p>
        </>
      )}

      <p className="mt-2.5 text-ink-3">
        {view === "network"
          ? lens === "rate"
            ? "Size and line weight — spend in the range."
            : level === "campaign"
              ? "Size and line weight — spend in the range. Line color — platform; a campaign on two takes the one that spent most."
              : "Size and line weight — spend in the range. Line color — platform."
          : view === "angle"
            ? "A creative repeats once per angle it carries, so angle totals overlap."
            : "Header size — spend in the range. A name repeats once per pairing."}
      </p>
    </div>
  );
}

/** Default export so `next/dynamic` can load it as the page's only RF chunk. */
export default function CanvasFlow(props: Parameters<typeof Flow>[0]) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
