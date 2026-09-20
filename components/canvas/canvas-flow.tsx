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
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Film, Image as ImageIcon, Layers, Search } from "lucide-react";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PriorityStars } from "@/components/creative/priority-stars";
import { PLATFORM_COLOR } from "@/lib/palette";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/creative-status";
import {
  CAMPAIGN_STATUS_DOT,
  CAMPAIGN_STATUS_LABEL,
} from "@/lib/campaign-status";
import { int, pct1, roas, usd, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CANVAS_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  bipartiteOrder,
  bipartitePositions,
  edgeWidth,
  focusFor,
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
  /** The primary node ids — their edges and neighbours light up with them. */
  ids: string[];
  /** Pan/zoom to the focused subgraph (search + insight chips; not a click). */
  fit: boolean;
}

type PlatformKey = keyof typeof PLATFORM_COLOR;
const platformColor = (p: string) =>
  PLATFORM_COLOR[p as PlatformKey] ?? "var(--ink-3)";

const TYPE_ICON = { video: Film, image: ImageIcon, slides: Layers } as const;

type FlowNode = Node<{ node: CanvasNode }>;

// ── Nodes ────────────────────────────────────────────────────────────────────
// Tokens only, so all four themes hold. Handles exist because edges need
// anchors; they are invisible and inert (nothing connects on this page).
const HANDLE = "!h-1 !w-1 !min-w-0 !border-0 !bg-transparent !opacity-0";
const SHELL =
  "h-full w-full rounded-lg border border-line bg-surface px-3 py-2 shadow-sm transition-colors hover:border-line-2";

const CampaignNodeView = memo(function CampaignNodeView({
  data,
}: NodeProps<FlowNode>) {
  const n = data.node as CanvasCampaignNode;
  return (
    <div className={SHELL}>
      <div className="flex items-center gap-1.5">
        <PlatformDot platform={n.platform as PlatformKey} size="sm" />
        <span className="truncate text-xs font-medium text-ink" title={n.name}>
          {n.name}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="rounded border border-line bg-surface-2 px-1.5 text-[10px] leading-5 text-ink-2">
          {n.objective}
        </span>
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: CAMPAIGN_STATUS_DOT[n.status] }}
          role="img"
          aria-label={CAMPAIGN_STATUS_LABEL[n.status]}
          title={CAMPAIGN_STATUS_LABEL[n.status]}
        />
        <span className="num ml-auto text-xs tabular-nums text-ink">
          {usdCompact(n.spend)}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className={HANDLE} isConnectable={false} />
    </div>
  );
});

const CreativeNodeView = memo(function CreativeNodeView({
  data,
}: NodeProps<FlowNode>) {
  const n = data.node as CanvasCreativeNode;
  const TypeIcon = TYPE_ICON[n.type];
  return (
    <div className={cn(SHELL, "flex items-center gap-2")}>
      <Handle type="target" position={Position.Left} className={HANDLE} isConnectable={false} />
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
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: STATUS_DOT[n.status] }}
            role="img"
            aria-label={STATUS_LABEL[n.status]}
            title={STATUS_LABEL[n.status]}
          />
          <PriorityStars value={n.priority} className="scale-90 origin-left" />
          <span className="num ml-auto text-xs tabular-nums text-ink">
            {n.spend > 0 ? usdCompact(n.spend) : "idle"}
          </span>
        </div>
      </div>
    </div>
  );
});

const NODE_TYPES = { campaign: CampaignNodeView, creative: CreativeNodeView };

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
  focus,
  onFocus,
  onOpen,
}: {
  graph: CanvasGraph;
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

  const positions = useMemo(
    () => bipartitePositions(bipartiteOrder(graph)),
    [graph],
  );
  const maxEdgeSpend = useMemo(
    () => graph.edges.reduce((m, e) => Math.max(m, e.spend), 0),
    [graph],
  );
  const lit = useMemo(
    () => (focus ? focusFor(focus.ids, graph.edges) : null),
    [focus, graph],
  );

  const nodes: FlowNode[] = useMemo(
    () =>
      [...graph.campaigns, ...graph.creatives].map((n) => ({
        id: n.id,
        type: n.kind,
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        // Fixed size — see CANVAS_NODE_HEIGHT. `measured` is supplied too:
        // this list is rebuilt on every focus change and culled off-screen
        // (`onlyRenderVisibleElements`), so React Flow would otherwise have no
        // measured size for most nodes — and `fitView({ nodes })` silently
        // ignores any node without one (the viewport snapped to identity).
        width: CANVAS_NODE_WIDTH,
        height: CANVAS_NODE_HEIGHT,
        measured: { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT },
        data: { node: n },
        style: {
          opacity: lit && !lit.nodes.has(n.id) ? 0.15 : 1,
          transition: "opacity 120ms",
        },
      })),
    [graph, positions, lit],
  );

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        // Wide enough to hover without pixel-hunting a 1px line.
        interactionWidth: 14,
        style: {
          stroke: platformColor(e.platform),
          strokeWidth: edgeWidth(e.spend, maxEdgeSpend),
          // Subtle by default; full strength in focus; nearly gone when dimmed.
          opacity: lit ? (lit.edges.has(e.id) ? 0.9 : 0.06) : 0.35,
          transition: "opacity 120ms",
        },
      })),
    [graph, maxEdgeSpend, lit],
  );

  // Pan/zoom to the focused subgraph when the request asks for it.
  useEffect(() => {
    if (!focus?.fit || !lit) return;
    void flow.fitView({
      nodes: [...lit.nodes].map((id) => ({ id })),
      padding: 0.25,
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
    (e: React.MouseEvent, fn: FlowNode) => {
      const n = fn.data.node;
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
    [at],
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
            <p className="num text-xs tabular-nums text-ink">{usd(edge.spend)}</p>
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
    onFocus({ ids: [n.id], fit: true });
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        style={FLOW_THEME}
        fitView
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
        onNodeClick={(_, n) => onFocus({ ids: [n.id], fit: false })}
        onNodeDoubleClick={(_, n) => onOpen((n as FlowNode).data.node)}
        onPaneClick={() => onFocus(null)}
        onNodeMouseEnter={nodeTip}
        onNodeMouseMove={nodeTip}
        onNodeMouseLeave={() => setTip(null)}
        onEdgeMouseEnter={edgeTip}
        onEdgeMouseMove={edgeTip}
        onEdgeMouseLeave={() => setTip(null)}
        onMoveStart={() => setTip(null)}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="!hidden rounded-lg border border-line sm:!block"
          nodeColor={(n) => {
            const node = (n as FlowNode).data.node;
            return node.kind === "campaign" ? platformColor(node.platform) : "var(--ink-3)";
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

/** Default export so `next/dynamic` can load it as the page's only RF chunk. */
export default function CanvasFlow(props: Parameters<typeof Flow>[0]) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
