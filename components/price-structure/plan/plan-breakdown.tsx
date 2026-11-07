"use client";

import { useMemo } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { blend, type Blend, type Line } from "@/price-structure/engine/blend";
import type { Product, Settings } from "@/price-structure/engine/types";
import { money0, num2, pct1, pct2, roas2, usd0 } from "@/price-structure/format";
import { Num } from "../num";
import { productColor } from "../palette";
import { SectionCard } from "../section-card";

interface Row {
  key: string;
  kind: "product" | "offer";
  label: string;
  sub?: string;
  color?: string;
  b: Blend;
  spendShare: number;
}

/** "Plan breakdown" (brief §6.4): products with orders (their blend), then their offers, then a total. */
export function PlanBreakdown({ lines, total, products, settings, mult, perLabel }: { lines: readonly Line[]; total: Blend; products: readonly Product[]; settings: Settings; mult: number; perLabel: string }) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const spend = total.adSpend || 1;
    for (const p of products) {
      const mine = lines.filter((l) => l.product.id === p.id && l.orders > 0);
      if (mine.length === 0) continue;
      const pb = blend(mine, settings);
      out.push({ key: p.id, kind: "product", label: p.name, color: productColor(p.colorSlot), b: pb, spendShare: pb.adSpend / spend });
      for (const l of mine) {
        const ob = blend([l], settings);
        out.push({ key: l.offer.id, kind: "offer", label: l.offer.name, b: ob, spendShare: ob.adSpend / spend });
      }
    }
    return out;
  }, [lines, total.adSpend, products, settings]);

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: "name",
        label: "Product / offer",
        pinned: true,
        render: (r) => (
          <span className={r.kind === "offer" ? "block truncate pl-5 text-ink-2" : "inline-flex items-center gap-2 font-medium text-ink"} dir="auto">
            {r.color && <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />}
            <span className="truncate">{r.label}</span>
          </span>
        ),
        total: () => "Total",
      },
      { key: "orders", label: "Orders", align: "right", render: (r) => <span className="tabular-nums">{num2(r.b.orders * mult)}</span>, total: () => <span className="tabular-nums">{num2(total.orders * mult)}</span> },
      { key: "revenue", label: "Revenue (SAR)", align: "right", render: (r) => <span className="tabular-nums">{money0(r.b.gross * mult)}</span>, total: () => <span className="tabular-nums">{money0(total.gross * mult)}</span> },
      { key: "budget", label: "Ad budget ($)", align: "right", render: (r) => <span className="tabular-nums">{usd0((r.b.adSpend * mult) / settings.usdToSar)}</span>, total: () => <span className="tabular-nums">{usd0((total.adSpend * mult) / settings.usdToSar)}</span> },
      { key: "spendShare", label: "Share of spend", align: "right", render: (r) => <span className="tabular-nums">{pct1(r.spendShare)}</span>, total: () => <span className="tabular-nums">100%</span> },
      { key: "roas", label: "Platform ROAS", align: "right", render: (r) => <span className="tabular-nums">{roas2(r.b.platformRoas)}</span>, total: () => <span className="tabular-nums">{roas2(total.platformRoas)}</span> },
      { key: "acct", label: "Acct. ROAS", align: "right", render: (r) => <span className="tabular-nums">{roas2(r.b.accountantRoas)}</span>, total: () => <span className="tabular-nums">{roas2(total.accountantRoas)}</span> },
      { key: "cogsPct", label: "COGS %", align: "right", render: (r) => <span className="tabular-nums">{pct2(r.b.cogsPct)}</span>, total: () => <span className="tabular-nums">{pct2(total.cogsPct)}</span> },
      { key: "mktPct", label: "Marketing %", align: "right", render: (r) => <span className="tabular-nums">{pct2(r.b.marketingPct)}</span>, total: () => <span className="tabular-nums">{pct2(total.marketingPct)}</span> },
      { key: "cml", label: "CML (SAR)", align: "right", render: (r) => <Num value={r.b.profit * mult} kind="money0" />, total: () => <Num value={total.profit * mult} kind="money0" /> },
      { key: "cmlPct", label: "CML %", align: "right", render: (r) => <Num value={r.b.margin} kind="pct2" />, total: () => <Num value={total.margin} kind="pct2" /> },
    ],
    [mult, total, settings.usdToSar],
  );
  const hideable = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.PS_PLAN_BREAKDOWN, hideable, defaults: hideable });

  return (
    <SectionCard title={`Plan breakdown ${perLabel}`} subtitle="Revenue is what customers pay incl. VAT. CML counts delivered orders only." contentClassName="px-0">
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        rowClassName={(r) => (r.kind === "product" ? "bg-surface-2/40" : "")}
        showTotals={rows.length > 0}
        minWidthClass="min-w-[960px]"
        empty={<span className="text-xs text-ink-3">No orders planned.</span>}
        {...cols.tableProps}
      />
    </SectionCard>
  );
}
