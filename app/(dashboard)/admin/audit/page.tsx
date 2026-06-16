import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listAuditEvents, auditCategoryCounts } from "@/db/queries/audit";
import type { AuditEntityType } from "@/lib/audit";
import { AuditFeed } from "@/components/audit/audit-feed";

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

export default async function AuditPage({ searchParams }: Props) {
  await requireAdmin();
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Admin
        </div>
        <h1 className="font-display text-4xl tracking-tight">Audit log</h1>
        <p className="text-ink-3 text-sm mt-1">
          {total.toLocaleString()} event{total === 1 ? "" : "s"} · newest first.
        </p>
      </div>

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
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs transition-colors " +
                (active
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "border-line bg-surface text-ink-2 hover:bg-surface-2")
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
    </div>
  );
}
