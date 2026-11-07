"use client";

import { useSearchParams } from "next/navigation";
import { shallowParams } from "@/lib/shallow-url";

/**
 * A chart's VIEW — its metric, Smooth and Group — lives in the URL as SHALLOW
 * presentation params (R-102, 2026-11; D12): history-API writes, no server
 * render. Pick ROAS + Smooth, open a creative, press Back, and the chart is
 * as you left it; a copied link shows the same chart. Each chart takes its
 * own `prefix` (`ot` → `?otm=roas&ots=1&otg=1`) so two charts on one page
 * never share a param. Hidden series stay local state.
 *
 * A default is written as the param's ABSENCE, so an untouched chart keeps a
 * clean URL; an unknown metric in the URL reads as the default.
 */
export function readChartView<M extends string>(
  params: { get(key: string): string | null },
  prefix: string,
  metrics: readonly M[],
  defaultMetric: M,
): { metric: M; smooth: boolean; group: boolean } {
  const raw = params.get(`${prefix}m`);
  const metric = raw !== null && (metrics as readonly string[]).includes(raw) ? (raw as M) : defaultMetric;
  return { metric, smooth: params.get(`${prefix}s`) === "1", group: params.get(`${prefix}g`) === "1" };
}

export function useChartView<M extends string>(prefix: string, metrics: readonly M[], defaultMetric: M) {
  const view = readChartView(useSearchParams(), prefix, metrics, defaultMetric);
  const write = (key: string, value: string | null) =>
    shallowParams((p) => (value === null ? p.delete(key) : p.set(key, value)), "replace");
  return {
    ...view,
    setMetric: (m: M) => write(`${prefix}m`, m === defaultMetric ? null : m),
    setSmooth: (on: boolean) => write(`${prefix}s`, on ? "1" : null),
    setGroup: (on: boolean) => write(`${prefix}g`, on ? "1" : null),
  };
}
