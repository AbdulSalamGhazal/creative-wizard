"use client";

import { InfoTip } from "@/components/ui/info-tip";
import { StatusDot } from "@/components/ui/status-dot";
import { dateTimeLabel, int, relativeTime } from "@/lib/format";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { cn } from "@/lib/utils";
import type { StoreConnectionStatus } from "@/db/queries/store-connector";

/** No order event for this long reads as "delayed". */
export const CONNECTION_QUIET_MS = 6 * 60 * 60 * 1000;

export type ConnectionState = "waiting" | "live" | "delayed";

/** Pure, so the three states are testable without a clock. */
export function connectionState(
  s: Pick<StoreConnectionStatus, "lastEventAt" | "lastPullError">,
  nowMs: number,
): ConnectionState {
  if (s.lastPullError) return "delayed";
  if (!s.lastEventAt) return "waiting";
  return nowMs - new Date(s.lastEventAt).getTime() > CONNECTION_QUIET_MS ? "delayed" : "live";
}

const DOT: Record<ConnectionState, string> = {
  waiting: "var(--ink-3)",
  live: "var(--pos)",
  delayed: "var(--warn)",
};

const STATE_WORD: Record<ConnectionState, string> = {
  waiting: "Connected, no orders received yet",
  live: "Receiving orders",
  delayed: "Delayed",
};

/**
 * The Salla feed's one line under the Orders title: a dot (the state), when
 * the last order arrived, how many came today. Rendered only for a brand
 * linked to a store — an unlinked brand's page is exactly as it was.
 */
export function StoreConnectionLine({ status }: { status: StoreConnectionStatus }) {
  useMinuteTick();
  const state = connectionState(status, Date.now());
  const parts = ["Salla"];
  parts.push(
    status.lastEventAt ? `last order ${relativeTime(status.lastEventAt)}` : "waiting for the first order",
  );
  if (status.ordersToday > 0) parts.push(`${int(status.ordersToday)} today`);
  if (status.lastPullError) parts.push("catch-up failed");

  return (
    <p
      className={cn(
        "mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs tabular-nums",
        state === "delayed" ? "text-warn" : "text-ink-2",
      )}
    >
      <StatusDot color={DOT[state]} label={STATE_WORD[state]} dotOnly />
      <span className="sr-only">{STATE_WORD[state]}.</span>
      <span>{parts.join(" · ")}</span>
      <InfoTip label="About the Salla connection">
        {`Orders arrive from Salla within a few minutes, and a catch-up runs every night${
          status.lastPullAt ? ` (last ${dateTimeLabel(status.lastPullAt)})` : ""
        }. Uploads still work: on an order Salla already sent they only add the columns Salla doesn't.`}
      </InfoTip>
    </p>
  );
}
