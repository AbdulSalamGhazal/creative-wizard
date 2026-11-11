import Link from "@/components/nav/link";
import { int } from "@/lib/format";
import { parseAuditBefore } from "@/validators/audit";
import { Button } from "@/components/ui/button";
import { refusable, requirePermission } from "@/lib/auth";
import { AccessRefused } from "@/components/layout/access-refused";
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
  price_structure: "Pricing",
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
  searchParams: Promise<{ category?: string; before?: string }>;
}

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 200;

function pageHref({ category, before }: { category: string; before: number | undefined }): string {
  const q = new URLSearchParams();
  if (category !== "all") q.set("category", category);
  if (before !== undefined) q.set("before", String(before));
  const qs = q.toString();
  return qs ? `/admin/audit?${qs}` : "/admin/audit";
}

export default async function AuditPage({ searchParams }: Props) {
  if (!(await refusable(() => requirePermission(AUDIT_GATE)))) {
    return <AccessRefused page="Audit log" perm={AUDIT_GATE} />;
  }
  const { category, before: rawBefore } = await searchParams;
  // "Load older" pages by cursor (R-117): events strictly before this id.
  const before = parseAuditBefore(rawBefore);

  const selected = CATEGORY_OPTIONS.find((c) => c.value === category)?.value ?? "all";
  const [rows, counts] = await Promise.all([
    listAuditEvents({
      category: selected === "all" ? undefined : selected,
      beforeId: before,
      limit: PAGE_SIZE,
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
            {int(total)} event{total === 1 ? "" : "s"}
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

      {(rows.length === PAGE_SIZE || before !== undefined) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {before !== undefined && (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref({ category: selected, before: undefined })}>Newest</Link>
            </Button>
          )}
          {rows.length === PAGE_SIZE && (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref({ category: selected, before: rows[rows.length - 1]!.id })}>
                Load older
              </Link>
            </Button>
          )}
        </div>
      )}
    </PageShell>
  );
}
