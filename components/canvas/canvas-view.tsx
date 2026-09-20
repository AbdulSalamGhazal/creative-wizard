"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNavTransition } from "@/lib/nav-progress";
import {
  canvasInsights,
  type CanvasGraph,
  type CanvasNode,
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

export function CanvasView({
  graph,
  rangeLabel,
}: {
  graph: CanvasGraph;
  rangeLabel: string;
}) {
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const [focus, setFocus] = useState<CanvasFocusRequest | null>(null);

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
      {insights.length > 0 && (
        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
          {insights.map((i) => {
            const on = activeKey(i.focusIds);
            return (
              <button
                key={i.key}
                type="button"
                aria-pressed={on}
                onClick={() => setFocus(on ? null : { ids: i.focusIds, fit: true })}
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
        <CanvasFlow graph={graph} focus={focus} onFocus={setFocus} onOpen={open} />
      </div>

      <p className="text-[11px] text-ink-3">
        {int(graph.campaigns.length)} campaigns · {int(graph.creatives.length)}{" "}
        creatives · {int(graph.edges.length)} connections. A solid line is
        spending here now, a dashed one spent in the range but has stopped; click
        to focus, double-click to open, Esc to clear.
      </p>
    </div>
  );
}
