"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNavTransition } from "@/lib/nav-progress";
import {
  buildClusters,
  CANVAS_VIEW_LABEL,
  CANVAS_VIEWS,
  canvasInsights,
  parseCanvasView,
  type CanvasGraph,
  type CanvasInsight,
  type CanvasNode,
  type CanvasViewMode,
} from "@/lib/canvas";
import type { CanvasFocusRequest } from "@/components/canvas/canvas-flow";

/**
 * React Flow loads HERE, lazily, and nowhere else — `ssr: false` because the
 * canvas measures the DOM, and dynamic so the library's weight lands on
 * /canvas only (verified in the build's route table).
 */
const CanvasFlow = dynamic(() => import("@/components/canvas/canvas-flow"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

const NO_CLUSTERS: never[] = [];

const VIEW_OPTIONS = CANVAS_VIEWS.map((value) => ({
  value,
  label: CANVAS_VIEW_LABEL[value],
}));

/**
 * What an insight chip lights up differs by view, so its tooltip says so.
 * "Most shared" is the one with a best view: By campaign draws the creative
 * once per campaign, so focusing it shows the sharing itself.
 */
function insightTitle(key: CanvasInsight["key"], view: CanvasViewMode): string {
  switch (key) {
    case "most-shared":
      return view === "campaign"
        ? "Lights every copy of this creative — one per campaign it runs in."
        : "Best seen in By campaign, where the creative appears once per campaign it runs in.";
    case "no-live-creatives":
      return view === "creative"
        ? "Lights these campaigns' chips wherever they appear."
        : view === "campaign"
          ? "Lights these campaigns' clusters — every chip inside is dashed."
          : "Focuses these campaigns — every line out of them is dashed.";
    case "idle-active":
      return view === "campaign"
        ? "Lights the Idle creatives cluster."
        : "Focuses the active creatives with no spend in this range.";
  }
}

export function CanvasView({
  graph,
  rangeLabel,
}: {
  graph: CanvasGraph;
  rangeLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();
  // Focus is held in ENTITY ids, so it RE-MAPS when the view changes: focus a
  // creative in the network, switch to By campaign, and its copies are lit.
  const [focus, setFocus] = useState<CanvasFocusRequest | null>(null);

  // `?view=` is URL-backed so a comment's captured query string reproduces
  // the view — and validated, so a bad value is just the network. Switching
  // is a pure re-layout of data already on the client: history.replaceState
  // updates the URL (Next syncs useSearchParams) with NO server round-trip.
  const view = parseCanvasView(searchParams.get("view"));
  const setView = useCallback(
    (next: CanvasViewMode) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "network") params.delete("view");
      else params.set("view", next);
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
      // Keep the focus, but never yank the viewport on a switch — the new
      // view's own fit runs instead.
      setFocus((f) => (f ? { ...f, fit: "none" } : f));
    },
    [pathname, searchParams],
  );

  // The cluster model is a pure function of the graph — nothing re-queried.
  const clustered = useMemo(
    () => (view === "network" ? null : buildClusters(graph, view)),
    [graph, view],
  );

  // Computed from the SAME graph the canvas draws, so a chip can never point
  // at a node that isn't there.
  const insights = useMemo(() => canvasInsights(graph), [graph]);

  const open = useCallback(
    (node: CanvasNode) => {
      const href =
        node.kind === "campaign"
          ? `/campaigns/${encodeURIComponent(node.name)}`
          : `/library/${encodeURIComponent(node.name)}`;
      startNav(() => router.push(href));
    },
    [router, startNav],
  );

  const empty = graph.campaigns.length === 0 && graph.creatives.length === 0;

  if (empty) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-sm text-ink-2">Nothing spent in {rangeLabel} under these filters.</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-ink-3">
          The canvas draws a line wherever a creative spent inside a campaign —
          campaigns on the left, creatives on the right — so you can see what
          is shared, what is stale and what is idle. Widen the date range or
          loosen the filters to bring connections in.
        </p>
      </div>
    );
  }

  const activeKey = (ids: string[]) =>
    focus !== null &&
    focus.ids.length === ids.length &&
    ids.every((id) => focus.ids.includes(id));

  return (
    <div className="space-y-3">
      {/* Insights: the page TELLS you the patterns; a chip focuses its nodes.
          Scrolls sideways on a phone rather than stacking into a wall. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <SegmentedControl
        ariaLabel="Canvas view"
        options={VIEW_OPTIONS}
        value={view}
        onChange={setView}
        className="shrink-0"
      />
      {insights.length > 0 && (
        <div className="-mx-1 flex min-w-0 flex-1 basis-64 items-center gap-2 overflow-x-auto px-1 pb-1">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
          {insights.map((i) => {
            const on = activeKey(i.focusIds);
            return (
              <button
                key={i.key}
                type="button"
                aria-pressed={on}
                title={insightTitle(i.key, view)}
                onClick={() => setFocus(on ? null : { ids: i.focusIds, fit: "all" })}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors",
                  on
                    ? "border-line-2 bg-surface-2 text-ink"
                    : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                {i.label}
              </button>
            );
          })}
        </div>
      )}
      </div>

      {clustered?.truncated && (
        <p className="text-xs text-ink-3">
          Showing the top {int(clustered.truncated.shownChips)} of{" "}
          {int(clustered.truncated.totalChips)} pairings by spend — narrow the
          filters for the rest.
        </p>
      )}

      {graph.truncated && (
        <p className="text-xs text-ink-3">
          {graph.truncated.shownEdges < graph.truncated.totalEdges && (
            <>
              Showing the top {int(graph.truncated.shownEdges)} of{" "}
              {int(graph.truncated.totalEdges)} connections by spend — narrow the
              filters for the rest.
            </>
          )}
          {graph.truncated.idleHidden > 0 && (
            <>
              {" "}
              {int(graph.truncated.idleHidden)} idle creative
              {graph.truncated.idleHidden === 1 ? "" : "s"} not drawn.
            </>
          )}
        </p>
      )}

      <div className="h-[calc(100vh-17rem)] min-h-[420px] overflow-hidden rounded-lg border border-line bg-background">
        <CanvasFlow
          graph={graph}
          view={view}
          clusters={clustered?.clusters ?? NO_CLUSTERS}
          focus={focus}
          onFocus={setFocus}
          onOpen={open}
        />
      </div>

      <p className="text-[11px] text-ink-3">
        {int(graph.campaigns.length)} campaigns · {int(graph.creatives.length)}{" "}
        creatives · {int(graph.edges.length)} connections.{" "}
        {view === "network"
          ? "A solid line is spending here now, a dashed one spent in the range but has stopped;"
          : view === "campaign"
            ? "A creative appears once per campaign it ran in — a solid chip is spending there now, a dashed one has stopped;"
            : "A campaign appears once per creative it ran — a solid chip is spending there now, a dashed one has stopped;"}{" "}
        click to focus, double-click to open, Esc to clear.
      </p>
    </div>
  );
}
