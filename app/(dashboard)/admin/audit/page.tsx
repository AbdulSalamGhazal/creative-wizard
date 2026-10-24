import { int } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { AUDIT_GATE } from "@/lib/page-gates";
import { listAuditEvents, auditCategoryCounts } from "@/db/queries/audit";
import type { AuditEntityType } from "@/lib/audit";
import { AuditFeed } from "@/components/audit/audit-feed";
import { AuditFilterBar } from "@/components/audit/audit-filter-bar";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

/**
 * One label per audit entity type. Typed as a FULL Record, so adding a new
 * entity type to `AuditEntityType` fails compilation until it's labelled here —
 * the old hand-kept array had silently fallen three categories behind
 * (campaign, store, budget were unreachable in the filter).
 */
const CATEGORY_LABELS: Record<AuditEntityType, string> = {
  creative: "Creatives",
  campaign: "Campaigns",
  product: "Products",
  landing_page: "Landing pages",
  angle: "Angles",
  // Legacy: rows written before the 2026-09 tag → angle rename.
  tag: "Tags (legacy)",
  upload: "Ad uploads",
  store: "Store",
  budget: "Budget",
  audience: "Funnel audience",
  notification: "Notifications",
  comment: "Comments",
  exclusion: "Exclusions",
  user: "Users",
  mapping: "CSV mapping",
  auth: "Auth",
  view: "Views",
  rating: "Rate rules",
  account: "Brands",
};

const CATEGORY_OPTIONS: Array<{ value: AuditEntityType | "all"; label: string }> = [
  { value: "all", label: "All activity" },
  ...(Object.entries(CATEGORY_LABELS) as Array<[AuditEntityType, string]>).map(
    ([value, label]) => ({ value, label }),
  ),
];

interface Props {
  searchParams: Promise<{ category?: string }>;
}

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: Props) {
  await requirePermission(AUDIT_GATE);
  const { category } = await searchParams;

  const selected = CATEGORY_OPTIONS.find((c) => c.value === category)?.value ?? "all";
  const [rows, counts] = await Promise.all([
    listAuditEvents({
      category: selected === "all" ? undefined : selected,
      limit: 200,
    }),
    auditCategoryCounts(),
  ]);
  const countByCat = new Map(counts.map((c) => [c.category, c.count]));
  const total = counts.reduce((s, c) => s + c.count, 0);

  return (
    <PageShell width="admin">
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        subtitle={
          <>
            {int(total)} event{total === 1 ? "" : "s"} · newest
            first.
          </>
        }
      />

      <AuditFilterBar
        category={selected === "all" ? null : selected}
        options={CATEGORY_OPTIONS.filter((o) => o.value !== "all").map((o) => ({
          value: o.value,
          label: o.label,
          hint: int(countByCat.get(o.value) ?? 0),
        }))}
      />

      <AuditFeed rows={rows} filtered={selected !== "all"} />

      {rows.length === 200 && (
        <p className="text-ink-3 text-xs text-center">
          Showing the most recent 200 events. Older entries remain in the DB.
        </p>
      )}
    </PageShell>
  );
}
