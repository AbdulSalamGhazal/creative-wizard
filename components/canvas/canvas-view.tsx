"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/lib/brand-nav";
import { shallowHref, shallowParams } from "@/lib/shallow-url";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNavTransition } from "@/lib/nav-progress";
import { adSetPath, campaignPath } from "@/lib/campaign";
import {
  buildClusters,
  CANVAS_FOCUS_NOUN,
  CANVAS_LENS_LABEL,
  CANVAS_LENSES,
  CANVAS_LEVEL_OPTIONS,
  CANVAS_VIEWS,
  canvasInsights,
  canvasLevelNoun,
  canvasViewLabel,
  focusLevel,
  focusParamFor,
  inspectFor,
  isAngleHeaderId,
  parentNodeId,
  parseCanvasLens,
  parseCanvasView,
  type CanvasGraph,
  type CanvasLens,
  type CanvasLevel,
  type CanvasInsight,
  type CanvasLinkedFocus,
  type CanvasNode,
  type CanvasViewMode,
} from "@/lib/canvas";
import type { CanvasFocusRequest } from "@/components/canvas/canvas-flow";
import { EmptyState } from "@/components/ui/empty-state";
import { CanvasInspector } from "@/components/canvas/canvas-inspector";
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

/**
 * The inspector is a COLUMN beside the canvas from `sm` up (it takes this much
 * width from the pane) and an overlay over the canvas's lower half below it.
 */
const INSPECTOR_WIDTH = 280;
/** The phone overlay's share of the canvas height — matches `h-[55%]`. */
const INSPECTOR_PHONE_COVER = 0.55;
const WIDE_QUERY = "(min-width: 640px)";
function subscribeWide(cb: () => void): () => void {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const readWide = (): boolean => window.matchMedia(WIDE_QUERY).matches;
const readWideServer = (): boolean => true;

/** The insight chips that only focus campaigns — By angle draws none. */
const CAMPAIGN_ONLY_INSIGHTS = new Set<CanvasInsight["key"]>(["no-live-creatives", "leans-on-one"]);

const LENS_OPTIONS = CANVAS_LENSES.map((value) => ({
  value,
  label: CANVAS_LENS_LABEL[value],
}));

/**
 * What an insight chip lights up differs by view, so its tooltip says so.
 * "Most shared" is the one with a best view: By campaign draws the creative
 * once per campaign, so focusing it shows the sharing itself. The campaign
 * side is named after the LEVEL drawn ("ad set" / "campaign").
 */
function insightTitle(
  key: CanvasInsight["key"],
  view: CanvasViewMode,
  level: CanvasLevel,
): string {
  const one = canvasLevelNoun(level);
  const many = canvasLevelNoun(level, 2);
  switch (key) {
    case "most-shared":
      if (view === "angle") return "Lights this creative in every angle it carries.";
      return view === "campaign"
        ? `Lights every copy of this creative — one per ${one} it runs in.`
        : `Best seen in ${canvasViewLabel("campaign", level)}, where the creative appears once per ${one} it runs in.`;
    case "no-live-creatives":
      return view === "creative"
        ? `Lights these ${many}' chips wherever they appear.`
        : view === "campaign"
          ? `Lights these ${many}' clusters — every chip inside is dashed.`
          : `Focuses these ${many} — every line out of them is dashed.`;
    case "idle-active":
      return view === "campaign" || view === "angle"
        ? "Lights the Idle creatives cluster."
        : "Focuses the active creatives with no spend in this range.";
    // The Rate patterns use your Rate rules (Configuration › Rate rules).
    case "losing-everywhere":
      return `Rated Bad in two or more ${many} and not Good or Decent in any — pairings too small to judge don't count.`;
    case "leans-on-one":
      return `One creative took 70% or more of the ${one}'s spend in this range, though the ${one} ran others.`;
    case "launched":
      return view === "angle"
        ? `First spend ever falls inside this range. Lights the launched creatives; launched ${many} show in the other views.`
        : `First spend ever falls inside this range — creatives and ${many}.`;
    case "unscaled-winner":
      return `Rated Good and still spending in ${level === "campaign" ? "a campaign" : "an ad set"}, but not running in any other ${one} yet.`;
  }
}

export function CanvasView({
  graph,
  rangeLabel,
  rateRules,
  linkedFocus,
}: {
  graph: CanvasGraph;
  rangeLabel: string;
  /** The brand's DEFAULT Rate rules — the legend's thresholds. */
  rateRules: RatingRules;
  /** The URL's `?focus=`, resolved by the page against this graph. */
  linkedFocus: CanvasLinkedFocus | null;
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
  // A link's `?focus=` OPENS the canvas on that node, inspector and all.
  const [focus, setFocus] = useState<CanvasFocusRequest | null>(() =>
    linkedFocus?.drawn ? { ids: [linkedFocus.nodeId], fit: "first", inspect: true } : null,
  );
  // …and a linked node that isn't drawn is SAID, not silently dropped.
  const [missing, setMissing] = useState<CanvasLinkedFocus | null>(() =>
    linkedFocus && !linkedFocus.drawn ? linkedFocus : null,
  );
  // A server render with a new answer (a filter or range change while a node
  // is in the URL): follow it — it may have appeared or dropped out. Adjusted
  // during render (React's previous-props pattern), not in an effect.
  const linkKey = linkedFocus ? `${linkedFocus.nodeId}|${linkedFocus.drawn}` : "";
  const [seenLinkKey, setSeenLinkKey] = useState(linkKey);
  if (linkKey !== seenLinkKey) {
    setSeenLinkKey(linkKey);
    if (linkedFocus && !linkedFocus.drawn) {
      setMissing(linkedFocus);
      setFocus(null);
    } else {
      setMissing(null);
      if (linkedFocus) setFocus({ ids: [linkedFocus.nodeId], fit: "first", inspect: true });
    }
  }
  // A LEVEL change redraws the campaign side under new node ids: a focus the
  // link doesn't carry across (a chip's group focus) is dropped, never left
  // pointing at nodes that are gone.
  const level = graph.level;
  const [seenLevel, setSeenLevel] = useState(level);
  if (level !== seenLevel) {
    setSeenLevel(level);
    if (!linkedFocus) setFocus(null);
  }
  // Every user-made focus change goes through here: it supersedes the notice.
  const focusTo = useCallback((next: CanvasFocusRequest | null) => {
    setMissing(null);
    setFocus(next);
  }, []);

  // `?focus=` follows the INSPECTED node (a chip's multi-node focus is
  // recomputed from the range, so it stays out of the link). A shallow
  // REPLACE, like ?view= and ?lens=: clicking through nodes adds no Back
  // steps, and nothing is re-queried. The unresolved link's value is kept
  // while its notice shows, so the address bar still says what it was.
  useEffect(() => {
    const want = focusParamFor(focus) ?? missing?.nodeId ?? null;
    if (new URL(window.location.href).searchParams.get("focus") === want) return;
    shallowParams((p) => {
      if (want) p.set("focus", want);
      else p.delete("focus");
    }, "replace");
  }, [focus, missing]);

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
      // An angle header's focus means nothing outside By angle — drop it.
      setFocus((f) =>
        !f ? f : f.ids.some(isAngleHeaderId) && next !== "angle" ? null : { ...f, fit: "none" },
      );
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

  // `?level=` — Campaigns · Ad sets. Unlike the view and the lens it is a
  // SERVER param: the level decides how the scan is folded, before totals and
  // the cap, so the switch is a navigation (progress bar and all). An
  // inspected AD SET follows up to its campaign, an inspected creative stays
  // (it is drawn at both levels); a campaign has no one ad set to land on.
  const setLevel = useCallback(
    (next: CanvasLevel) => {
      if (next === level) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "adset") params.delete("level");
      else params.set("level", next);
      const inspectedId = focus?.inspect ? (focus.ids[0] ?? null) : null;
      const inspected = inspectedId
        ? (graph.campaigns.find((c) => c.id === inspectedId) ??
          graph.creatives.find((c) => c.id === inspectedId))
        : undefined;
      const carried =
        inspected?.kind === "creative"
          ? inspected.id
          : inspected && next === "campaign" && inspected.parentId
            ? parentNodeId(inspected.parentId)
            : null;
      if (carried) params.set("focus", carried);
      else params.delete("focus");
      const qs = params.toString();
      startNav(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [focus, graph, level, pathname, router, searchParams, startNav],
  );

  const viewOptions = useMemo(
    () => CANVAS_VIEWS.map((value) => ({ value, label: canvasViewLabel(value, level) })),
    [level],
  );

  // The cluster model is a pure function of the graph — nothing re-queried.
  const clustered = useMemo(
    () => (view === "network" ? null : buildClusters(graph, view)),
    [graph, view],
  );

  // Computed from the SAME graph the canvas draws, so a chip can never point
  // at a node that isn't there.
  // By angle draws no campaigns, so the two campaign-only chips would light
  // nothing there — they step aside in that view, and come back on a switch.
  const allInsights = useMemo(() => canvasInsights(graph), [graph]);
  const insights = useMemo(
    () =>
      view === "angle"
        ? allInsights.filter((i) => !CAMPAIGN_ONLY_INSIGHTS.has(i.key))
        : allInsights,
    [allInsights, view],
  );

  const open = useCallback(
    (node: CanvasNode) => {
      const href =
        node.kind === "campaign"
          ? node.level === "campaign" && node.network
            ? campaignPath(node.network, node.name)
            : adSetPath(node.name)
          : `/library/${encodeURIComponent(node.name)}`;
      startNav(() => router.push(href));
    },
    [router, startNav],
  );

  // The CLICK INSPECTOR: a single-entity focus asked for it (a node click, a
  // search pick, a pairing row). It reads the drawn graph — no query.
  const inspection = useMemo(
    () => (focus?.inspect && focus.ids[0] ? inspectFor(focus.ids[0], graph) : null),
    [focus, graph],
  );
  const wide = useSyncExternalStore(subscribeWide, readWide, readWideServer);
  const inspect = useCallback(
    (id: string) => focusTo({ ids: [id], fit: "first", inspect: true }),
    [focusTo],
  );
  const closeInspector = useCallback(() => focusTo(null), [focusTo]);

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
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-ink-3" aria-hidden>
          Show
        </span>
        <SegmentedControl
          ariaLabel="Show campaigns or ad sets"
          options={CANVAS_LEVEL_OPTIONS}
          value={level}
          onChange={setLevel}
        />
      </div>
      <SegmentedControl
        ariaLabel="Canvas view"
        options={viewOptions}
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
                title={insightTitle(i.key, view, level)}
                onClick={() => focusTo(on ? null : { ids: i.focusIds, fit: "all" })}
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

      {missing && (
        <Callout tone="info" className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            {missing.name ? (
              focusLevel(missing.kind) !== null && focusLevel(missing.kind) !== level ? (
                // Drawn at the OTHER level — say which, instead of blaming
                // the range or the filters.
                <>
                  <bdi className="font-medium">{missing.name}</bdi> is{" "}
                  {missing.kind === "campaign" ? "an ad set" : "a campaign"} — switch Show to{" "}
                  {missing.kind === "campaign" ? "Ad sets" : "Campaigns"} to see it.
                </>
              ) : (
                <>
                  <bdi className="font-medium">{missing.name}</bdi>{" "}
                  isn&apos;t on the canvas for this range and these filters.
                </>
              )
            ) : (
              <>The linked {CANVAS_FOCUS_NOUN[missing.kind]} isn&apos;t in this brand.</>
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2"
            onClick={() => setMissing(null)}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
        </Callout>
      )}

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
        className="relative flex h-[calc(100dvh-17rem)] min-h-[320px] sm:min-h-[420px] overflow-hidden rounded-lg border border-line bg-background"
        style={frameTop === null ? undefined : { height: `calc(100dvh - ${frameTop}px - 1.5rem)` }}
      >
        <div className="h-full min-w-0 flex-1">
        <CanvasFlow
          graph={graph}
          view={view}
          lens={lens}
          rateRules={rateRules}
          clusters={clustered?.clusters ?? NO_CLUSTERS}
          focus={focus}
          onFocus={focusTo}
          onOpen={open}
          reservedWidth={inspection && wide ? INSPECTOR_WIDTH : 0}
          coveredBottom={inspection && !wide ? INSPECTOR_PHONE_COVER : 0}
        />
        </div>
        {inspection && (
          <CanvasInspector
            key={inspection.node.id}
            inspection={inspection}
            level={level}
            onInspect={inspect}
            onOpen={open}
            onClose={closeInspector}
            // A column from sm up; below it, an overlay over the lower half
            // (the canvas stays visible and clickable above it).
            className="absolute inset-x-0 bottom-0 z-10 h-[55%] border-t border-line shadow-lg sm:static sm:z-auto sm:h-full sm:w-[280px] sm:shrink-0 sm:border-l sm:border-t-0 sm:shadow-none"
          />
        )}
      </div>

      <p className="text-[11px] text-ink-3">
        {int(graph.campaigns.length)} {canvasLevelNoun(level, graph.campaigns.length)} ·{" "}
        {int(graph.creatives.length)} creatives · {int(graph.edges.length)} connections.{" "}
        {view === "network"
          ? "A solid line is spending here now, a dashed one spent in the range but has stopped;"
          : view === "campaign"
            ? `A creative appears once per ${canvasLevelNoun(level)} it ran in — a solid chip is spending there now, a dashed one has stopped;`
            : view === "angle"
              ? "A creative appears once per angle it carries — a solid chip is spending somewhere now, a dashed one has stopped;"
              : `${level === "campaign" ? "A campaign" : "An ad set"} appears once per creative it ran — a solid chip is spending there now, a dashed one has stopped;`}{" "}
        click for details, double-click to open, Esc to clear.
      </p>
    </div>
  );
}
