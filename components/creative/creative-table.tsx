"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import type { CreativeListRow } from "@/db/queries/creatives";
import type { CreativeSort } from "@/validators/creative";
import { StatusBadge } from "@/components/creative/status-badge";
import { STATUS_LABEL } from "@/lib/creative-status";
import { rowsToCsv, todayStamp, type CsvColumn } from "@/lib/csv-export";
import { isoDate, usd } from "@/lib/format";

const CSV_COLUMNS: CsvColumn<CreativeListRow>[] = [
  { key: "name", label: "Creative", value: (r) => r.name },
  { key: "product", label: "Product", value: (r) => r.productName },
  { key: "type", label: "Type", value: (r) => r.type },
  { key: "status", label: "Status", value: (r) => STATUS_LABEL[r.status] },
  { key: "launchDate", label: "Launch date", value: (r) => r.launchDate ?? "" },
  { key: "spend7d", label: "7d spend (USD)", value: (r) => r.spend7d },
  { key: "spend30d", label: "30d spend (USD)", value: (r) => r.spend30d },
  { key: "tags", label: "Tags", value: (r) => r.tags.join("; ") },
];

const TYPE_LABEL: Record<CreativeListRow["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

// Sortable columns → their asc/desc URL sort values (validated in
// validators/creative.ts). Clicking a header cycles desc → asc → default.
const DEFAULT_SORT: CreativeSort = "launched-desc";
const SORTS = {
  name: { asc: "name-asc", desc: "name-desc" },
  product: { asc: "product-asc", desc: "product-desc" },
  type: { asc: "type-asc", desc: "type-desc" },
  status: { asc: "status-asc", desc: "status-desc" },
  tag: { asc: "tag-asc", desc: "tag-desc" },
  launched: { asc: "launched-asc", desc: "launched-desc" },
  spend7: { asc: "spend7-asc", desc: "spend7-desc" },
  spend30: { asc: "spend-asc", desc: "spend-desc" },
} satisfies Record<string, { asc: CreativeSort; desc: CreativeSort }>;

const COL_WIDTHS_KEY = "creatives-col-widths";
const MIN_COL_WIDTH = 90;

export function CreativeTable({
  rows,
  total,
  listCtx,
}: {
  rows: CreativeListRow[];
  /** Total matching across the filter (for the "Showing N of M" count). */
  total?: number;
  listCtx?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSort = (searchParams.get("sort") as CreativeSort) ?? DEFAULT_SORT;

  // ---- Resizable text columns (Creative, Product) ----
  const [widths, setWidths] = useState<Record<string, number>>({});
  const thRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COL_WIDTHS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        if (parsed && typeof parsed === "object") setWidths(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const startResize = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const measured = thRefs.current[key]?.getBoundingClientRect().width ?? 160;
      const startW = widths[key] ?? measured;
      const onMove = (ev: MouseEvent) => {
        const w = Math.max(MIN_COL_WIDTH, Math.round(startW + (ev.clientX - startX)));
        setWidths((prev) => ({ ...prev, [key]: w }));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        setWidths((prev) => {
          try {
            localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(prev));
          } catch {
            /* ignore */
          }
          return prev;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
    },
    [widths],
  );
  const widthStyle = (key: string): React.CSSProperties | undefined => {
    const w = widths[key];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };

  // ---- Sort link helper ----
  const sortState = (col: keyof typeof SORTS) => {
    const { asc, desc } = SORTS[col];
    const active = currentSort === asc || currentSort === desc;
    const dir: "asc" | "desc" = currentSort === asc ? "asc" : "desc";
    let next: CreativeSort | null;
    if (currentSort === desc) next = asc;
    else if (currentSort === asc) next = null; // reset to default
    else next = desc;
    const params = new URLSearchParams(searchParams.toString());
    if (next === null || next === DEFAULT_SORT) params.delete("sort");
    else params.set("sort", next);
    const qs = params.toString();
    return { active, dir, href: qs ? `${pathname}?${qs}` : pathname };
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-ink-2 text-sm">No creatives match these filters.</p>
      </div>
    );
  }

  const csvContent = rowsToCsv(rows, CSV_COLUMNS);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3 num">
          Showing {rows.length}
          {total !== undefined ? ` of ${total}` : ""} creatives
        </p>
        <DownloadCsvButton
          csvContent={csvContent}
          filename={`creatives-${todayStamp()}.csv`}
        />
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-surface [&>th]:border-b [&>th]:border-line">
              <SortableTextTh
                label="Creative"
                state={sortState("name")}
                width={widths.name}
                style={widthStyle("name")}
                onResizeStart={(e) => startResize("name", e)}
                thRef={(el) => {
                  thRefs.current.name = el;
                }}
              />
              <SortableTextTh
                label="Product"
                state={sortState("product")}
                width={widths.product}
                style={widthStyle("product")}
                onResizeStart={(e) => startResize("product", e)}
                thRef={(el) => {
                  thRefs.current.product = el;
                }}
              />
              <SortableTh label="Type" state={sortState("type")} />
              <SortableTh label="Status" state={sortState("status")} />
              <SortableTh label="Launch date" state={sortState("launched")} />
              <SortableTh label="7d spend" state={sortState("spend7")} numeric />
              <SortableTh label="30d spend" state={sortState("spend30")} numeric />
              <SortableTh label="Tags" state={sortState("tag")} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                className="hover:bg-surface-2/60 transition-colors"
              >
                <td
                  style={widthStyle("name")}
                  className={`px-3 py-2.5 ${widths.name ? "" : "whitespace-nowrap"}`}
                >
                  <Link
                    href={`/creatives/${encodeURIComponent(r.name)}${listCtx ? `?${listCtx}` : ""}`}
                    title={r.name}
                    className={
                      "font-mono text-ink text-[13px] hover:text-brand transition-colors " +
                      (widths.name ? "block truncate" : "")
                    }
                  >
                    {r.name}
                  </Link>
                </td>
                <td
                  style={widthStyle("product")}
                  title={widths.product ? r.productName : undefined}
                  className={`px-3 py-2.5 text-ink-2 ${widths.product ? "truncate" : ""}`}
                >
                  {r.productName}
                </td>
                <td className="px-3 py-2.5 text-ink-2">{TYPE_LABEL[r.type]}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2.5 text-ink-2">
                  {r.launchDate ? isoDate(r.launchDate) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                  {r.spend7d > 0 ? usd(r.spend7d) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                  {r.spend30d > 0 ? usd(r.spend30d) : "—"}
                </td>
                <td className="px-3 py-2.5 text-ink-2">
                  {r.tags.length === 0 ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <div className="flex items-center gap-1 flex-wrap">
                      {r.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center h-5 px-1.5 rounded text-[10px] bg-surface-2 border border-line text-ink-2"
                        >
                          {t}
                        </span>
                      ))}
                      {r.tags.length > 3 && (
                        <span className="text-[10px] text-ink-3">
                          +{r.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SortState {
  active: boolean;
  dir: "asc" | "desc";
  href: string;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active)
    return <ArrowUpDown className="w-3 h-3 text-ink-3 opacity-60" aria-hidden />;
  return dir === "asc" ? (
    <ArrowUp className="w-3 h-3 text-brand" aria-hidden />
  ) : (
    <ArrowDown className="w-3 h-3 text-brand" aria-hidden />
  );
}

/** Plain sortable header (numeric or text), no resize handle. */
function SortableTh({
  label,
  state,
  numeric = false,
}: {
  label: string;
  state: SortState;
  numeric?: boolean;
}) {
  return (
    <th
      className={
        "font-medium px-3 py-2.5 whitespace-nowrap " +
        (numeric ? "text-right" : "text-left")
      }
    >
      <Link
        href={state.href}
        scroll={false}
        className={
          "inline-flex items-center gap-1 hover:text-ink transition-colors " +
          (numeric ? "justify-end " : "") +
          (state.active ? "text-brand" : "")
        }
      >
        {label}
        <SortIcon active={state.active} dir={state.dir} />
      </Link>
    </th>
  );
}

/** Sortable text header with a drag-to-resize handle on the right edge. */
function SortableTextTh({
  label,
  state,
  width,
  style,
  onResizeStart,
  thRef,
}: {
  label: string;
  state: SortState;
  width?: number;
  style?: React.CSSProperties;
  onResizeStart: (e: React.MouseEvent) => void;
  thRef: (el: HTMLTableCellElement | null) => void;
}) {
  return (
    <th
      ref={thRef}
      style={style}
      className={
        "relative font-medium px-3 py-2.5 text-left " +
        (width ? "" : "whitespace-nowrap")
      }
    >
      <Link
        href={state.href}
        scroll={false}
        className={
          "inline-flex items-center gap-1 max-w-full hover:text-ink transition-colors " +
          (state.active ? "text-brand" : "")
        }
      >
        <span className={width ? "truncate" : ""}>{label}</span>
        <SortIcon active={state.active} dir={state.dir} />
      </Link>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label} column`}
        onMouseDown={onResizeStart}
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-brand/40 active:bg-brand/60"
      />
    </th>
  );
}
