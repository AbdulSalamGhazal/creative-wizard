"use client";

import { useSearchParams } from "next/navigation";
import { PageTabs } from "@/components/layout/page-tabs";
import { ORDER_STAGES, ORDER_STAGE_LABEL, type OrderStage } from "@/store/order-status";

/**
 * Store → Orders' status tabs (user decision 2026-11-27): All, then each
 * stage with its count under the current range, search and filters — so a
 * count is exactly what clicking the tab lists, and All is their sum. "No
 * status" (uploaded orders) appears only when it has orders. A tab is a URL
 * param (`?stage=`), never remembered, and changing it returns to page 1.
 */
export function StoreOrderStageTabs({
  stage,
  counts,
}: {
  stage: OrderStage | null;
  counts: Record<OrderStage, number>;
}) {
  const searchParams = useSearchParams();
  const href = (s: OrderStage | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (s) next.set("stage", s);
    else next.delete("stage");
    next.delete("page");
    const qs = next.toString();
    return `/store/orders${qs ? `?${qs}` : ""}`;
  };
  const all = ORDER_STAGES.reduce((a, s) => a + counts[s], 0);
  const tabs = [
    { key: "all", label: "All", href: href(null), count: all },
    ...ORDER_STAGES.filter((s) => s !== "none" || counts.none > 0 || stage === "none").map(
      (s) => ({ key: s, label: ORDER_STAGE_LABEL[s], href: href(s), count: counts[s] }),
    ),
  ];
  return <PageTabs tabs={tabs} active={stage ?? "all"} />;
}
