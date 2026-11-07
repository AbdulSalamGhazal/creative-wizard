"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Target as TargetIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { MetricCard } from "@/components/overview/metric-card";
import { TABLE_KEYS } from "@/lib/table-columns";
import { useNavTransition } from "@/lib/nav-progress";
import { evaluateAll, type OfferRow } from "@/price-structure/engine/all-offers";
import { METRICS, metricValue, statusAgainst } from "@/price-structure/engine/metrics";
import type { Status, Target } from "@/price-structure/engine/types";
import { formatMetric } from "@/price-structure/format";
import { productColor, STATUS_META } from "../palette";
import { PsPageHeader } from "../ps-page-header";
import { SectionCard } from "../section-card";
import { StatusBadge } from "../status-badge";
import { useOpenVersion } from "../version-provider";
import { BulletRows } from "./bullet-rows";
import { TargetsEditor } from "./targets-editor";
import { WhatItTakes } from "./what-it-takes";

type Mode = "check" | "seek";

const INTRO =
  "Set target A (the minimum you accept) and target B (your stretch goal), then check every offer against them. You can also work out what has to change to reach them.";

/** Targets (brief §6.3): check offers against A / B, or work out what it takes. */
export function TargetsView() {
  const version = useOpenVersion();
  const [mode, setMode] = useState<Mode>("check");
  const data = version?.data;
  const evaluated = useMemo(() => (data ? evaluateAll(data) : null), [data]);
  if (!version || !data || !evaluated) return <PsPageHeader title="Targets" info={INTRO} />;

  return (
    <>
      <PsPageHeader title="Targets" info={INTRO} />
      <div className="flex justify-end">
        <SegmentedControl<Mode>
          ariaLabel="Targets mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "check", label: "Check offers" },
            { value: "seek", label: "What it takes" },
          ]}
        />
      </div>
      {mode === "check" ? <CheckOffers rows={evaluated.rows} targets={data.targets} /> : <WhatItTakes data={data} rows={evaluated.rows} />}
    </>
  );
}

function CheckOffers({ rows, targets }: { rows: readonly OfferRow[]; targets: readonly Target[] }) {
  const enabled = targets.filter((t) => t.enabled);
  const [distanceId, setDistanceId] = useState<string>("");
  const distance = enabled.find((t) => t.id === distanceId) ?? enabled[0] ?? null;
  return (
    <>
      <TargetsEditor />
      {enabled.length === 0 ? (
        <EmptyState title="No active targets: add a target or turn one on." size="sm" />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {enabled.map((t) => {
              const counts: Record<Status, number> = { b: 0, a: 0, miss: 0 };
              for (const r of rows) counts[statusAgainst(r.r, t)] += 1;
              return (
                <MetricCard
                  key={t.id}
                  label={METRICS[t.metric].label}
                  value={`A ${formatMetric(t.metric, t.a)} · B ${formatMetric(t.metric, t.b)}`}
                  icon={TargetIcon}
                  hideBreakdown
                  footer={
                    <span className="flex flex-wrap gap-x-2">
                      <span className={STATUS_META.b.text}>✓ B {counts.b}</span>
                      <span className={STATUS_META.a.text}>◐ A {counts.a}</span>
                      <span className={STATUS_META.miss.text}>✕ Miss {counts.miss}</span>
                    </span>
                  }
                />
              );
            })}
          </div>
          {distance && rows.length > 0 && (
            <SectionCard
              title="Distance to target"
              subtitle="The bar is the offer's value. The tick marks are A and B. The colours behind the bar show the zones: miss, between A and B, and past B."
              actions={
                enabled.length > 1 ? (
                  <Select value={distance.id} onValueChange={setDistanceId}>
                    <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Target to show">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {enabled.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {METRICS[t.metric].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : undefined
              }
            >
              <BulletRows rows={rows} target={distance} />
            </SectionCard>
          )}
          {rows.length > 0 && <TargetMatrix rows={rows} targets={enabled} />}
        </>
      )}
    </>
  );
}

/** The offer's editor on Products & offers, keeping the open version (`?v=`). */
function offerEditorHref(r: OfferRow, v: string | null): string {
  return `/price-structure/products/${r.product.id}/${r.offer.id}${v ? `?v=${v}` : ""}`;
}

function TargetMatrix({ rows, targets }: { rows: readonly OfferRow[]; targets: readonly Target[] }) {
  const router = useRouter();
  const v = useSearchParams().get("v");
  const [, startNav] = useNavTransition();
  const columns = useMemo<DataColumn<OfferRow>[]>(() => {
    const cols: DataColumn<OfferRow>[] = [
      {
        key: "offer",
        label: "Offer",
        pinned: true,
        // A real link (keyboard, new tab — R-008); the row click goes there too.
        href: (r) => offerEditorHref(r, v),
        render: (r) => (
          <span className="flex items-start gap-2">
            <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: productColor(r.product.colorSlot) }} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-ink" dir="auto">{r.offer.name}</span>
              <span className="block truncate text-[10px] text-ink-2" dir="auto">{r.product.name}</span>
            </span>
          </span>
        ),
      },
      ...targets.map(
        (t): DataColumn<OfferRow> => ({
          key: `t-${t.id}`,
          label: METRICS[t.metric].short,
          align: "right",
          render: (r) => (
            <span className="inline-flex items-center gap-1.5">
              <span className="tabular-nums">{formatMetric(t.metric, metricValue(r.r, t.metric))}</span>
              <StatusBadge status={statusAgainst(r.r, t)} compact />
            </span>
          ),
        }),
      ),
      { key: "overall", label: "Overall", align: "right", render: (r) => (r.overall ? <StatusBadge status={r.overall} compact /> : "—") },
    ];
    return cols;
  }, [targets, v]);
  const hideable = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.PS_TARGET_MATRIX, hideable, defaults: hideable });
  return (
    <SectionCard title="Every offer against every target" subtitle="Click a row to edit that offer." contentClassName="px-0">
      <DataTable<OfferRow>
        columns={columns}
        rows={[...rows]}
        rowKey={(r) => r.offer.id}
        minWidthClass="min-w-[640px]"
        onRowClick={(r) => startNav(() => router.push(offerEditorHref(r, v)))}
        {...cols.tableProps}
      />
    </SectionCard>
  );
}
