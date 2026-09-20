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
import { PLATFORM_COLOR } from "@/lib/palette";
import {
  CREATIVE_STATUSES,
  STATUS_DOT,
  STATUS_LABEL,
} from "@/lib/creative-status";
import {
  CAMPAIGN_STATUS_DOT,
  CAMPAIGN_STATUS_LABEL,
} from "@/lib/campaign-status";
import { int, longDate, pct1, roas, usd, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ChipNodeView,
  ClusterFrameView,
  type ChipData,
} from "@/components/canvas/cluster-nodes";
import {
  CANVAS_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  canvasNodeSizes,
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
  type CanvasSide,
  type CanvasViewMode,
  type CanvasCampaignNode,
  type CanvasCreativeNode,
  type CanvasGraph,
  type CanvasNode,
} from "@/lib/canvas";

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
}

type PlatformKey = keyof typeof PLATFORM_COLOR;
const platformColor = (p: string) =>
  PLATFORM_COLOR[p as PlatformKey] ?? "var(--ink-3)";

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
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="truncate rounded border border-line bg-surface-2 px-1.5 text-[10px] leading-5 text-ink-2">
            {n.objective}
          </span>
          <span className="shrink-0 text-[10px] text-ink-3">
            {CAMPAIGN_STATUS_LABEL[n.status]}
          </span>
          <span
            className={cn(
              "num shrink-0 text-[10px] tabular-nums",
              n.liveChildren === 0 ? "text-warn" : "text-ink-2",
            )}
            title={`${n.liveChildren} of ${n.totalChildren} creatives currently spending here`}
            aria-label={`${n.liveChildren} of ${n.totalChildren} creatives currently spending here`}
          >
            {n.liveChildren}/{n.totalChildren}
          </span>
          <span className="num ml-auto shrink-0 text-xs tabular-nums text-ink">
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
            className="h-9 w-9 shrink-0 rounded border border-line bg-surface-2 bg-cover bg-center"
            style={{ backgroundImage: `url("${n.thumbnailUrl}")` }}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TypeIcon className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
            <span className="truncate font-mono text-[11px] text-ink" title={n.name}>
              {n.name}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] text-ink-3">{STATUS_LABEL[n.status]}</span>
            <PriorityStars value={n.priority} className="origin-left scale-90" />
            <span className="num ml-auto shrink-0 text-xs tabular-nums text-ink">
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

interface Tip {
  x: number;
  y: number;
  body: React.ReactNode;
}

function Flow({
  graph,
  view,
  clusters,
  focus,
  onFocus,
  onOpen,
}: {
  graph: CanvasGraph;
  view: CanvasViewMode;
  /** The cluster model for the two tree views (empty in the network view). */
  clusters: readonly CanvasCluster[];
  focus: CanvasFocusRequest | null;
  onFocus: (req: CanvasFocusRequest | null) => void;
  /** Double-click — the page decides where an entity's detail lives. */
  onOpen: (node: CanvasNode) => void;
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
  const columns = clusterColumnsFor(paneWidth);
  const clusterLayout = useMemo(
    () => (view === "network" ? null : clusterBoxes(clusters, columns, canvasNodeSizes(graph))),
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
          data: { entityId: entity.id, chip, entity } satisfies ChipData & { entityId: string },
          style: { opacity: dim(chip.id), transition: "opacity 120ms" },
        });
      }
    }
    return out;
  }, [clusterLayout, clusters, byId, dim]);

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
        // LIVE: solid, full platform color. PAUSED HERE: dashed and dimmed.
        const base = e.live ? 0.85 : 0.45;
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
            stroke: platformColor(e.platform),
            strokeWidth: edgeWidth(e.spend, maxEdgeSpend),
            strokeDasharray: e.live ? undefined : "6 5",
            opacity,
            transition: "opacity 120ms",
          },
        };
      }),
    [view, graph, creativeById, maxEdgeSpend, lit, preview],
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

  // Take the viewport where the focus request asks: everything lit (insight
  // chips) or just the first occurrence (search).
  useEffect(() => {
    if (!focus || focus.fit === "none" || !lit) return;
    const ids = focus.fit === "first" ? (lit.first ? [lit.first] : []) : [...lit.nodes];
    if (ids.length === 0) return;
    void flow.fitView({
      nodes: ids.map((id) => ({ id })),
      padding: focus.fit === "first" ? 1.2 : 0.25,
      duration: 400,
      maxZoom: 1.1,
    });
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
                    <span className="num tabular-nums text-ink">{usd(edge.spend)}</span>
                  </p>
                  <p className="mt-0.5 max-w-[16rem] text-[11px] text-ink-3">
                    {share === null ? "—" : pct1(share)} of{" "}
                    <span className="text-ink-2">{camp?.name ?? "the campaign"}</span>
                    &rsquo;s spend
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-[11px] text-ink-3">
                  Active, but no spend in this range.
                </p>
              )}
              <p className="mt-1 text-[10px] text-ink-3">Double-click to open</p>
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
              <dd className="num text-right tabular-nums text-ink">{usd(n.spend)}</dd>
              <dt className="text-ink-3">Conversions</dt>
              <dd className="num text-right tabular-nums text-ink">{int(n.conversions)}</dd>
              <dt className="text-ink-3">ROAS</dt>
              <dd className="num text-right tabular-nums text-ink">
                {roas(n.spend > 0 ? n.revenue / n.spend : null)}
              </dd>
            </dl>
            <p className="mt-1 text-[10px] text-ink-3">Double-click to open</p>
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
              <span className="num tabular-nums text-ink">{usd(edge.spend)}</span>
            </p>
            <p className="mt-0.5 max-w-[16rem] text-[11px] text-ink-3">
              {share === null ? "—" : pct1(share)} of{" "}
              <span className="text-ink-2">{camp?.name ?? "the campaign"}</span>
              &rsquo;s spend
            </p>
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
    onFocus({ ids: [n.id], fit: "first" });
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
          if (id) onFocus({ ids: [id], fit: "none" });
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
          <Legend view={view} />
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
              placeholder="Find a campaign or creative…"
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
                        {n.kind === "campaign" ? "Camp" : "Crtv"}
                      </span>
                      <span className="truncate">{n.name}</span>
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

/**
 * The legend — every encoding on the canvas, in one place. Collapsed to a "?"
 * chip by default (the canvas is the point; the key is for the first visit
 * and the occasional doubt) and remembered per browser. Tokens only.
 */
function Legend({ view }: { view: CanvasViewMode }) {
  const [open, setOpen] = useState(false);
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

  const swatch = "h-3 w-5 shrink-0 rounded-[3px] border-2 bg-surface";
  return (
    <div className="w-56 rounded-lg border border-line bg-surface p-3 text-[11px] text-ink-2 shadow-lg">
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
      <p className="mt-1 text-[10px] text-ink-3">
        Campaigns: {CAMPAIGN_STATUS_LABEL.active} / {CAMPAIGN_STATUS_LABEL.inactive}, same
        colors. “3/5” = creatives currently spending there.
      </p>

      {view !== "network" && (
        // The one extra line the cluster views need: there are no lines to
        // dash, so the pairing's state moves ONTO the duplicated chip.
        <>
          <p className="mb-1 mt-2.5 text-ink-3">Chip — a pairing, not the whole {view === "campaign" ? "creative" : "campaign"}</p>
          <ul className="space-y-1">
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-5 shrink-0 rounded-[3px] border-2 bg-surface" style={{ borderColor: "var(--ink-2)" }} />
              Solid — live here
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-5 shrink-0 rounded-[3px] border-2 border-dashed bg-transparent" style={{ borderColor: "var(--ink-2)" }} />
              Dashed + dimmed — paused here (the network&rsquo;s dashed line)
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

      <p className="mt-2.5 text-ink-3">
        {view === "network"
          ? "Size and line weight — spend in the range. Line color — platform."
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
