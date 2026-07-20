import Link from "next/link";
import { int } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { listAuditEvents, auditCategoryCounts } from "@/db/queries/audit";
import type { AuditEntityType } from "@/lib/audit";
import { AuditFeed } from "@/components/audit/audit-feed";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

const CATEGORY_OPTIONS: Array<{ value: AuditEntityType | "all"; label: string }> = [
  { value: "all", label: "All activity" },
  { value: "creative", label: "Creatives" },
  { value: "upload", label: "Uploads" },
  { value: "exclusion", label: "Exclusions" },
  { value: "user", label: "Users" },
  { value: "product", label: "Products" },
  { value: "tag", label: "Tags" },
  { value: "mapping", label: "CSV mapping" },
  { value: "auth", label: "Auth" },
  { value: "view", label: "Views" },
  { value: "rating", label: "Rating rules" },
  { value: "account", label: "Brands" },
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
