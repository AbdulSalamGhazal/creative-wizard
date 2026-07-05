"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Columns3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sparkline } from "@/components/charts/sparkline";
import { StatusBadge } from "@/components/creative/status-badge";
import { int, pct, ratio, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeaderboardRow } from "@/db/queries/performance";

type Num = number | null;
const fUsd = (v: Num) => (v === null ? "—" : usd(v));
const fPct = (v: Num) => (v === null ? "—" : pct(v));
const fRatio = (v: Num) => (v === null ? "—" : `${ratio(v)}×`);

const TYPE_LABEL: Record<LeaderboardRow["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

type ColKey =
  | "name"
  | "product"
  | "type"
  | "status"
  | "spend"
  | "cpm"
  | "impressions"
  | "clicks"
  | "ctr"
  | "voc"
  | "conversions"
  | "cvr"
  | "roas"
  | "revenue"
  | "cpa"
  | "trend";

interface Col {
  key: ColKey;
  label: string;
  width: number;
  align: "left" | "right";
  /** Default-visible. */
  on: boolean;
  /** Can't be hidden (the identity column). */
  locked?: boolean;
  render: (r: LeaderboardRow) => ReactNode;
}

// Order here is the display order. The Creative column flexes to fill leftover
// width (see the colgroup), so the table always spans the card; every other
// column is a fixed, resizable width. Default-visible set per the dashboard
// spec: Creative · Product · Status · Spend · CPM · CTR · VOC · CvR · CPA ·
// ROAS · Trend (the rest are available via the Columns menu).
const COLS: Col[] = [
  {
    key: "name",
    label: "Creative",
    width: 220,
    align: "left",
    on: true,
    locked: true,
    render: (r) => <span className="font-mono text-ink text-xs">{r.name}</span>,
  },
  { key: "product", label: "Product", width: 130, align: "left", on: true, render: (r) => <span className="text-ink-2">{r.productName}</span> },
  { key: "type", label: "Type", width: 80, align: "left", on: false, render: (r) => <span className="text-ink-2">{TYPE_LABEL[r.type]}</span> },
  { key: "status", label: "Status", width: 96, align: "left", on: true, render: (r) => <StatusBadge status={r.status} /> },
  { key: "spend", label: "Spend", width: 90, align: "right", on: true, render: (r) => <span className="text-ink">{usd(r.spend)}</span> },
  { key: "cpm", label: "CPM", width: 76, align: "right", on: true, render: (r) => <span className="text-ink-2">{fUsd(r.cpm)}</span> },
  { key: "impressions", label: "Impr.", width: 96, align: "right", on: false, render: (r) => <span className="text-ink-2">{int(r.impressions)}</span> },
  { key: "clicks", label: "Clicks", width: 84, align: "right", on: false, render: (r) => <span className="text-ink-2">{int(r.clicks)}</span> },
  { key: "ctr", label: "CTR", width: 74, align: "right", on: true, render: (r) => <span className="text-ink-2">{fPct(r.ctr)}</span> },
  { key: "voc", label: "VOC", width: 74, align: "right", on: true, render: (r) => <span className="text-ink-2">{fPct(r.voc)}</span> },
  { key: "conversions", label: "Conv.", width: 84, align: "right", on: false, render: (r) => <span className="text-ink-2">{int(r.conversions)}</span> },
  { key: "cvr", label: "CvR", width: 74, align: "right", on: true, render: (r) => <span className="text-ink-2">{fPct(r.cvr)}</span> },
  { key: "cpa", label: "CPA", width: 78, align: "right", on: true, render: (r) => <span className="text-ink-2">{fUsd(r.cpa)}</span> },
  { key: "roas", label: "ROAS", width: 78, align: "right", on: true, render: (r) => <span className="text-ink">{fRatio(r.roas)}</span> },
  { key: "revenue", label: "Revenue", width: 100, align: "right", on: false, render: (r) => <span className="text-ink-2">{fUsd(r.conversionValue)}</span> },
  { key: "trend", label: "Trend", width: 120, align: "left", on: true, render: (r) => <Sparkline values={r.sparkline} color="var(--brand-2)" responsive height={24} /> },
];

const COL_BY_KEY = Object.fromEntries(COLS.map((c) => [c.key, c])) as Record<ColKey, Col>;

// The ranking segmented control. `pick` selects the metric; `lower` flags the
// cost metric (CPM) so "top" means cheapest, not most expensive. Each maps to a
// column that is force-shown while it's the active ranking.
const RANK_OPTIONS: Array<{
  key: string;
  label: string;
  col: ColKey;
  pick: (r: LeaderboardRow) => number | null;
  lower?: boolean;
}> = [
  { key: "spend", label: "Spend", col: "spend", pick: (r) => r.spend },
  { key: "cpm", label: "CPM", col: "cpm", pick: (r) => r.cpm, lower: true },
  { key: "ctr", label: "CTR", col: "ctr", pick: (r) => r.ctr },
  { key: "voc", label: "VOC", col: "voc", pick: (r) => r.voc },
  { key: "cvr", label: "CvR", col: "cvr", pick: (r) => r.cvr },
  { key: "roas", label: "ROAS", col: "roas", pick: (r) => r.roas },
];

export function TopCreativesTable({
  rows,
  limit = 10,
}: {
  rows: LeaderboardRow[];
  limit?: number;
}) {
  const [rankBy, setRankBy] = useState("spend");
  const [hidden, setHidden] = useState<Set<ColKey>>(
    () => new Set(COLS.filter((c) => !c.on).map((c) => c.key)),
  );
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(COLS.map((c) => [c.key, c.width])),
  );
  const dragRef = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);

  const opt = RANK_OPTIONS.find((o) => o.key === rankBy) ?? RANK_OPTIONS[0]!;

  // Visible = not hidden, but always include the identity column and the metric
  // currently being ranked by (so you can see what you sorted on).
  const shown = useMemo(
    () => COLS.filter((c) => c.locked || c.key === opt.col || !hidden.has(c.key)),
    [hidden, opt.col],
  );

  const ranked = useMemo(() => {
    const withVal = rows.filter((r) => opt.pick(r) !== null);
    const without = rows.filter((r) => opt.pick(r) === null);
    withVal.sort((a, b) =>
      opt.lower ? opt.pick(a)! - opt.pick(b)! : opt.pick(b)! - opt.pick(a)!,
    );
    return [...withVal, ...without].slice(0, limit);
  }, [rows, opt, limit]);

  const toggleCol = (key: ColKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onResizeDown = (key: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startW: widths[key] ?? COL_BY_KEY[key].width };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setWidths((prev) => ({ ...prev, [d.key]: Math.max(44, d.startW + (ev.clientX - d.startX)) }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (rows.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
        No creatives with ≥ $300 spend in this window.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Toolbar: title (left) · ranking metric (center) · column toggles (right) */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="justify-self-start flex items-baseline gap-2">
          <h3 className="text-sm font-semibold leading-none text-ink">Top creatives</h3>
          <span className="text-[11px] text-ink-3">spend ≥ $300</span>
        </div>
        <div className="justify-self-center inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
          {RANK_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setRankBy(o.key)}
              className={cn(
                "px-2.5 py-1 rounded transition-colors",
                rankBy === o.key ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="justify-self-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line text-xs text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink transition-colors"
              >
                <Columns3 className="w-3.5 h-3.5" /> Columns{" "}
                <span className="text-ink-3">{shown.length}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 max-h-96 overflow-y-auto">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLS.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={c.locked || c.key === opt.col || !hidden.has(c.key)}
                  disabled={c.locked || c.key === opt.col}
                  onCheckedChange={() => toggleCol(c.key)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm num table-fixed">
          <colgroup>
            <col style={{ width: 36 }} />
            {shown.map((c) =>
              c.key === "name" ? (
                // No width → flexes to absorb leftover space so the table fills
                // the card; everything else stays a fixed, resizable width.
                <col key={c.key} />
              ) : (
                <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />
              ),
            )}
          </colgroup>
          <thead>
            <tr className="text-left text-label text-ink-3 select-none">
              <th className="font-medium px-2 py-2">#</th>
              {shown.map((c) => (
                <th key={c.key} className="relative font-medium px-2 py-2">
                  <div className={cn("truncate", c.align === "right" && "text-right")}>
                    {c.label}
                  </div>
                  {c.key !== "name" && (
                    <span
                      onMouseDown={(e) => onResizeDown(c.key, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand/40 active:bg-brand/60"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.map((r, i) => (
              <tr key={r.creativeId} className="hover:bg-surface-2/60 transition-colors">
                <td className="px-2 py-2.5 text-ink-3">{i + 1}</td>
                {shown.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-2 py-2.5 overflow-hidden whitespace-nowrap text-ellipsis",
                      c.align === "right" && "text-right",
                    )}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
