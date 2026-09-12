import Link from "next/link";
import { int } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { listAuditEvents, auditCategoryCounts } from "@/db/queries/audit";
import type { AuditEntityType } from "@/lib/audit";
import { AuditFeed } from "@/components/audit/audit-feed";
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
  angle: "Angles",
  // Legacy: rows written before the 2026-09 tag → angle rename.
  tag: "Tags (legacy)",
  upload: "Ad uploads",
  store: "Store",
  budget: "Budget",
  audience: "Funnel audience",
  notification: "Notifications",
  exclusion: "Exclusions",
  user: "Users",
  mapping: "CSV mapping",
  auth: "Auth",
  view: "Views",
  rating: "Rating rules",
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
  await requirePermission("audit.view");
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

      <div className="flex items-center gap-1.5 flex-wrap">
        {CATEGORY_OPTIONS.map((opt) => {
          const active = selected === opt.value;
          const count =
            opt.value === "all" ? total : (countByCat.get(opt.value) ?? 0);
          const href =
            opt.value === "all" ? "/admin/audit" : `/admin/audit?category=${opt.value}`;
          return (
            <Link
              key={opt.value}
              href={href}
              className={
                "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors " +
                (active
                  ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
                  : "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink")
              }
            >
              {opt.label}
              <span className="text-[10px] tabular-nums text-ink-3">{count}</span>
            </Link>
          );
        })}
      </div>

      <AuditFeed rows={rows} />

      {rows.length === 200 && (
        <p className="text-ink-3 text-xs text-center">
          Showing the most recent 200 events. Older entries remain in the DB.
        </p>
      )}
    </PageShell>
  );
}
