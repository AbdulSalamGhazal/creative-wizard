"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/lib/brand-nav";
import { shallowHref } from "@/lib/shallow-url";
import { Sparkles } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNavTransition } from "@/lib/nav-progress";
import {
  buildClusters,
  CANVAS_LENS_LABEL,
  CANVAS_LENSES,
  CANVAS_VIEW_LABEL,
  CANVAS_VIEWS,
  canvasInsights,
  parseCanvasLens,
  parseCanvasView,
  type CanvasGraph,
  type CanvasLens,
  type CanvasInsight,
  type CanvasNode,
  type CanvasViewMode,
} from "@/lib/canvas";
import type { CanvasFocusRequest } from "@/components/canvas/canvas-flow";
import { EmptyState } from "@/components/ui/empty-state";
import type { RatingRules } from "@/lib/rating";

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

const LENS_OPTIONS = CANVAS_LENSES.map((value) => ({
  value,
  label: CANVAS_LENS_LABEL[value],
}));

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
  rateRules,
}: {
  graph: CanvasGraph;
  rangeLabel: string;
  /** The brand's DEFAULT Rate rules — the legend's thresholds. */
  rateRules: RatingRules;
}) {
  // The canvas frame's distance from the top of the document, so it can fill
  // exactly the viewport below the header and the (wrapping) filter bars.
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameTop, setFrameTop] = useState<number | null>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () =>
      setFrameTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    measure();
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();
  // Focus is held in ENTITY ids, so it RE-MAPS when the view changes: focus a
  // creative in the network, switch to By campaign, and its copies are lit.
  const [focus, setFocus] = useState<CanvasFocusRequest | null>(null);

  // `?view=` is URL-backed so a comment's captured query string reproduces
  // the view — and validated, so a bad value is just the network. Switching
  // is a pure re-layout of data already on the client: a shallow replace
  // updates the URL (Next syncs useSearchParams) with NO server round-trip.
  const view = parseCanvasView(searchParams.get("view"));
  const setView = useCallback(
    (next: CanvasViewMode) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "network") params.delete("view");
      else params.set("view", next);
      const qs = params.toString();
      shallowHref(qs ? `${pathname}?${qs}` : pathname, "replace");
      // Keep the focus, but never yank the viewport on a switch — the new
      // view's own fit runs instead.
      setFocus((f) => (f ? { ...f, fit: "none" } : f));
    },
    [pathname, searchParams],
  );

  // `?lens=` follows `?view=` exactly: URL-backed (a comment reproduces it),
  // validated (anything unknown is the platform lens = the clean URL), and a
  // shallow replace — recolouring re-queries nothing. Focus is untouched.
  const lens = parseCanvasLens(searchParams.get("lens"));
  const setLens = useCallback(
    (next: CanvasLens) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "platform") params.delete("lens");
      else params.set("lens", next);
      const qs = params.toString();
      shallowHref(qs ? `${pathname}?${qs}` : pathname, "replace");
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
      <EmptyState
        size="lg"
        title={`Nothing spent in ${rangeLabel} under these filters.`}
        kind="filtered"
      />
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
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-ink-3" aria-hidden>
          Colour
        </span>
        <SegmentedControl
          ariaLabel="Colour lines by"
          options={LENS_OPTIONS}
          value={lens}
          onChange={setLens}
        />
      </div>
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

      {/* Fills the viewport below whatever sits above it (R-066): the bars
          wrap to 2-3 rows on a phone, so a fixed 17rem guess overshot and
          the page scrolled with the canvas half off-screen. `dvh` excludes
          iOS Safari's collapsing URL bar; the floor is lower on a phone. */}
      <div
        ref={frameRef}
        className="h-[calc(100dvh-17rem)] min-h-[320px] sm:min-h-[420px] overflow-hidden rounded-lg border border-line bg-background"
        style={frameTop === null ? undefined : { height: `calc(100dvh - ${frameTop}px - 1.5rem)` }}
      >
        <CanvasFlow
          graph={graph}
          view={view}
          lens={lens}
          rateRules={rateRules}
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
