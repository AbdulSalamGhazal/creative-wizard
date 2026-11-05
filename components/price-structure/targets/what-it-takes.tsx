"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { cn } from "@/lib/utils";
import type { OfferRow } from "@/price-structure/engine/all-offers";
import { goalSeek, LEVER_META, LEVERS, leverNow, type GoalSeekResult, type LeverKey, type LeverMeta } from "@/price-structure/engine/goal-seek";
import { METRICS, metricValue, statusAgainst } from "@/price-structure/engine/metrics";
import type { Product, Target, VersionData } from "@/price-structure/engine/types";
import { formatMetric, money2, pct1, pp1, roas2, signedPct1, usd2 } from "@/price-structure/format";
import { Field } from "../fields";
import { SectionCard } from "../section-card";
import { StatusBadge } from "../status-badge";

type View = "lever" | "offer";

function leverValue(meta: LeverMeta, v: number): string {
  switch (meta.unit) {
    case "sar":
      return `${money2(v)} SAR`;
    case "usd":
      return usd2(v);
    case "x":
      return `${roas2(v)}×`;
    case "pct":
      return pct1(v);
  }
}

/** A solved cell: "≥ value" / "≤ value", then "✓ already" or the change from now (brief §5.7). */
function GoalCell({ result, meta }: { result: GoalSeekResult; meta: LeverMeta }) {
  if (result.kind === "always") return <span className="text-ink-3">Met at any value</span>;
  if (result.kind === "unreachable") return <span className="text-ink-3">Not reachable</span>;
  const arrow = result.direction === "gte" ? "≥" : "≤";
  let note: string | null = null;
  if (result.alreadyMet) note = "✓ already";
  else if (meta.unit === "pct") note = pp1(result.value - result.now);
  else if (result.now !== 0) note = signedPct1(result.value / result.now - 1);
  return (
    <span className="num tabular-nums">
      {arrow} {leverValue(meta, result.value)}
      {note && <span className={cn("ml-1.5 text-[10px]", result.alreadyMet ? "text-pos" : "text-ink-3")}>{note}</span>}
    </span>
  );
}

/** "What it takes" (brief §6.3): goal seek, one lever across every offer or every lever on one offer. */
export function WhatItTakes({ data, rows }: { data: VersionData; rows: readonly OfferRow[] }) {
  const targets = data.targets;
  const [targetId, setTargetId] = useState<string>(targets[0]?.id ?? "");
  const [view, setView] = useState<View>("lever");
  const [lever, setLever] = useState<LeverKey>("cpaUsd");
  const [offerId, setOfferId] = useState<string>(rows[0]?.offer.id ?? "");

  const target = targets.find((t) => t.id === targetId) ?? targets[0] ?? null;
  const offerRow = rows.find((r) => r.offer.id === offerId) ?? rows[0] ?? null;

  if (!target) {
    return <EmptyState title="Add a target first." hint="Goal seek uses the A and B values of a target." size="sm" />;
  }
  const meta = METRICS[target.metric];
  const aText = formatMetric(target.metric, target.a);
  const bText = formatMetric(target.metric, target.b);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Target" hint={`A ${aText} · B ${bText}`}>
          <Select value={target.id} onValueChange={setTargetId}>
            <SelectTrigger size="sm" className="h-8 min-w-48 text-xs" aria-label="Target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {METRICS[t.metric].label}
                  {!t.enabled && " (off)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="View">
          <SegmentedControl<View>
            ariaLabel="Goal seek view"
            value={view}
            onChange={setView}
            options={[
              { value: "lever", label: "One lever, all offers" },
              { value: "offer", label: "One offer, all levers" },
            ]}
          />
        </Field>
        {view === "lever" ? (
          <Field label="Lever" hint="Everything else stays as it is">
            <Select value={lever} onValueChange={(v) => setLever(v as LeverKey)}>
              <SelectTrigger size="sm" className="h-8 min-w-48 text-xs" aria-label="Lever">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVERS.map((l) => (
                  <SelectItem key={l.key} value={l.key}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <Field label="Offer">
            <Select value={offerRow?.offer.id ?? ""} onValueChange={setOfferId}>
              <SelectTrigger size="sm" className="h-8 min-w-56 text-xs" aria-label="Offer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rows.map((r) => (
                  <SelectItem key={r.offer.id} value={r.offer.id}>
                    <span dir="auto">{r.product.name} · {r.offer.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      {view === "lever" ? (
        <LeverTable data={data} rows={rows} target={target} lever={lever} aText={aText} bText={bText} />
      ) : offerRow ? (
        <OfferTable data={data} row={offerRow} target={target} aText={aText} bText={bText} />
      ) : (
        <EmptyState title="No offers yet." size="sm" />
      )}
      <p className="sr-only">{meta.label}</p>
    </div>
  );
}

interface LeverRow {
  key: string;
  row: OfferRow;
  now: number;
  leverNow: number;
  a: GoalSeekResult;
  b: GoalSeekResult;
}

function LeverTable({ data, rows, target, lever, aText, bText }: { data: VersionData; rows: readonly OfferRow[]; target: Target; lever: LeverKey; aText: string; bText: string }) {
  const meta = METRICS[target.metric];
  const lm = LEVER_META[lever];
  const items = useMemo<LeverRow[]>(
    () =>
      rows.map((row) => ({
        key: row.offer.id,
        row,
        now: metricValue(row.r, target.metric),
        leverNow: leverNow(lever, row.product, row.r),
        a: goalSeek(row.product, row.offer, data.settings, lever, target.metric, target.a),
        b: goalSeek(row.product, row.offer, data.settings, lever, target.metric, target.b),
      })),
    [rows, data.settings, lever, target],
  );
  const columns: DataColumn<LeverRow>[] = [
    {
      key: "offer",
      label: "Offer",
      pinned: true,
      render: (r) => (
        <span className="block truncate" dir="auto" title={`${r.row.offer.name} · ${r.row.product.name}`}>
          {r.row.offer.name} <span className="text-ink-3">· {r.row.product.name}</span>
        </span>
      ),
    },
    { key: "now", label: `${meta.short} now`, align: "right", render: (r) => <span className="num tabular-nums">{formatMetric(target.metric, r.now)}</span> },
    { key: "status", label: "Status", align: "right", render: (r) => <StatusBadge status={statusAgainst(r.row.r, target)} compact /> },
    { key: "leverNow", label: `${lm.label} now`, align: "right", render: (r) => <span className="num tabular-nums">{leverValue(lm, r.leverNow)}</span> },
    { key: "a", label: "Needed for A", align: "right", render: (r) => <GoalCell result={r.a} meta={lm} /> },
    { key: "b", label: "Needed for B", align: "right", render: (r) => <GoalCell result={r.b} meta={lm} /> },
  ];
  const hideable = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.PS_WHAT_IT_TAKES, hideable, defaults: hideable });
  return (
    <SectionCard
      title={`${lm.label} needed for each offer`}
      subtitle={`To reach ${meta.label.toLowerCase()} of ${aText} (A) and ${bText} (B), changing only this lever. "Extra discount" is how much more you could give on top of today's offer.`}
      contentClassName="px-0"
    >
      <DataTable<LeverRow> columns={columns} rows={items} rowKey={(r) => r.key} minWidthClass="min-w-[760px]" {...cols.tableProps} />
    </SectionCard>
  );
}

interface OfferLeverRow {
  key: LeverKey;
  meta: LeverMeta;
  now: number;
  a: GoalSeekResult;
  b: GoalSeekResult;
}

function OfferTable({ data, row, target, aText, bText }: { data: VersionData; row: OfferRow; target: Target; aText: string; bText: string }) {
  const meta = METRICS[target.metric];
  const items = useMemo<OfferLeverRow[]>(
    () =>
      LEVERS.map((l) => ({
        key: l.key,
        meta: l,
        now: leverNow(l.key, row.product as Product, row.r),
        a: goalSeek(row.product, row.offer, data.settings, l.key, target.metric, target.a),
        b: goalSeek(row.product, row.offer, data.settings, l.key, target.metric, target.b),
      })),
    [row, data.settings, target],
  );
  const columns: DataColumn<OfferLeverRow>[] = [
    { key: "lever", label: "Lever", pinned: true, render: (r) => r.meta.label },
    { key: "now", label: "Now", align: "right", render: (r) => <span className="num tabular-nums">{leverValue(r.meta, r.now)}</span> },
    { key: "a", label: `Needed for A (${aText})`, align: "right", render: (r) => <GoalCell result={r.a} meta={r.meta} /> },
    { key: "b", label: `Needed for B (${bText})`, align: "right", render: (r) => <GoalCell result={r.b} meta={r.meta} /> },
  ];
  const hideable = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.PS_WHAT_IT_TAKES, hideable, defaults: hideable });
  const now = formatMetric(target.metric, metricValue(row.r, target.metric));
  return (
    <SectionCard
      title={
        <span dir="auto">
          What it takes: {row.product.name} · {row.offer.name}
        </span>
      }
      subtitle={`${meta.label} is ${now} now. Each line changes one lever on its own. Any one of them is enough to reach the target.`}
      contentClassName="px-0"
    >
      <DataTable<OfferLeverRow> columns={columns} rows={items} rowKey={(r) => r.key} minWidthClass="min-w-[640px]" {...cols.tableProps} />
    </SectionCard>
  );
}
