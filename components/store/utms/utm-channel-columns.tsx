import type { DataColumn } from "@/components/ui/data-table";
import { int, pct1 } from "@/lib/format";
import { channelSplit, type ChannelSplit } from "@/lib/store-utms";

/**
 * The OPTIONAL (defaultHidden) channel-split columns the UTM Sources and
 * Compare tables both offer — figures their source rows already carry (the
 * breakdown's two FILTERed counts and its revenue). Counts and shares only:
 * nothing here is compared with a platform's claim. `sortOf` lets Sources
 * sink its "Other" summary row.
 */
export function channelSplitColumns<R extends ChannelSplit>(opts: {
  sortOf: <V>(r: R, v: V) => V | null;
  totals: { orders: number; revenue: number; website: number; application: number };
  totalRevenue: number;
}): DataColumn<R>[] {
  const { sortOf, totals, totalRevenue } = opts;
  const t = channelSplit(totals, totalRevenue);
  const count = (v: number) => <span className="tabular-nums">{int(v)}</span>;
  return [
    {
      key: "website",
      label: "Website",
      align: "right",
      sortable: true,
      sortValue: (r) => sortOf(r, r.website),
      render: (r) => count(r.website),
      total: () => count(t.website),
    },
    {
      key: "application",
      label: "App",
      align: "right",
      sortable: true,
      sortValue: (r) => sortOf(r, r.application),
      render: (r) => count(r.application),
      total: () => count(t.application),
    },
    {
      key: "appShare",
      label: "App %",
      align: "right",
      sortable: true,
      sortValue: (r) => sortOf(r, r.appShare),
      csv: (r) => r.appShare,
      render: (r) => <span className="tabular-nums">{pct1(r.appShare)}</span>,
      total: () => <span className="tabular-nums">{pct1(t.appShare)}</span>,
    },
    {
      key: "unmappedChannel",
      label: "Channel unmapped",
      align: "right",
      sortable: true,
      info: "Orders whose channel maps to neither Website nor App.",
      sortValue: (r) => sortOf(r, r.unmappedChannel),
      render: (r) => <span className="tabular-nums text-ink-2">{int(r.unmappedChannel)}</span>,
      total: () => <span className="tabular-nums text-ink-2">{int(t.unmappedChannel)}</span>,
    },
    {
      key: "revenueShare",
      label: "% of revenue",
      align: "right",
      sortable: true,
      sortValue: (r) => sortOf(r, r.revenueShare),
      csv: (r) => r.revenueShare,
      render: (r) => <span className="tabular-nums">{pct1(r.revenueShare)}</span>,
      total: () => <span className="tabular-nums">{pct1(t.revenueShare)}</span>,
    },
  ];
}

/** Their keys — each table's `defaultHidden`. */
export const CHANNEL_SPLIT_KEYS = [
  "website",
  "application",
  "appShare",
  "unmappedChannel",
  "revenueShare",
] as const;
