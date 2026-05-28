import Link from "next/link";
import {
  GitBranch,
  Images,
  Layers3,
  LogIn,
  LogOut,
  Package,
  ShieldAlert,
  Trash2,
  Upload,
  UserPlus,
  Users,
  ListFilter,
} from "lucide-react";
import {
  AUDIT_LABELS,
  type AuditAction,
  type AuditEntityType,
} from "@/lib/audit";
import type { AuditFeedRow } from "@/db/queries/audit";
import { relativeTime } from "@/lib/format";

/**
 * Renders an append-only audit feed. Used by /admin/audit (full feed) and
 * by the per-creative Activity tab (filtered to one entity).
 *
 * The rows already arrive newest-first from `listAuditEvents`. Each row is a
 * line-item: actor avatar, action label, link to the affected entity when we
 * can derive one, and a relative timestamp. The `meta` jsonb is shown as a
 * single muted line summarizing the most useful fields per action type.
 */

interface Props {
  rows: AuditFeedRow[];
  /** When true (per-creative tab), suppress the actor's email/role chip. */
  compact?: boolean;
}

function entityHref(row: AuditFeedRow): string | null {
  switch (row.entityType) {
    case "creative":
      // entityLabel is the creative name we stored at write time.
      return row.entityLabel
        ? `/creatives/${encodeURIComponent(row.entityLabel)}`
        : null;
    case "upload":
      return "/uploads";
    case "product":
      return "/admin/catalog?tab=products";
    case "tag":
      return "/admin/catalog?tab=tags";
    case "user":
      return "/admin/users";
    case "mapping":
      return "/admin/catalog?tab=mapping";
    default:
      return null;
  }
}

function ActionIcon({ action }: { action: AuditAction }) {
  const map: Partial<Record<AuditAction, React.ComponentType<{ className?: string }>>> = {
    "creative.create": Images,
    "creative.update": Images,
    "creative.notes_update": Images,
    "creative.bulk_status": Images,
    "exclusion.exclude": Trash2,
    "exclusion.include": GitBranch,
    "upload.commit": Upload,
    "upload.rollback": GitBranch,
    "product.create": Package,
    "product.archive": Package,
    "product.restore": Package,
    "user.invite": UserPlus,
    "user.role_change": Users,
    "user.password_reset": ShieldAlert,
    "mapping.add": Layers3,
    "mapping.remove": Layers3,
    "auth.signin": LogIn,
    "auth.signin_failed": ShieldAlert,
    "auth.signout": LogOut,
    "auth.password_change": ShieldAlert,
  };
  const Icon = map[action] ?? ListFilter;
  return <Icon className="w-3.5 h-3.5" />;
}

function categoryColor(category: AuditEntityType): string {
  switch (category) {
    case "creative":
      return "border-brand/40 text-brand bg-brand/10";
    case "upload":
      return "border-pos/40 text-pos bg-pos/10";
    case "exclusion":
      return "border-warn/40 text-warn bg-warn/10";
    case "user":
      return "border-line-2 text-ink-2 bg-surface-2";
    case "product":
      return "border-line-2 text-ink-2 bg-surface-2";
    case "mapping":
      return "border-line-2 text-ink-3 bg-surface-2";
    case "auth":
      return "border-line-2 text-ink-3 bg-surface-2";
    default:
      return "border-line-2 text-ink-3 bg-surface-2";
  }
}

function metaSummary(row: AuditFeedRow): string | null {
  const m = row.meta;
  if (!m) return null;
  switch (row.action) {
    case "creative.bulk_status": {
      const count = m.count as number | undefined;
      const status = m.status as string | undefined;
      if (count && status) return `${count} → ${status}`;
      return null;
    }
    case "creative.update": {
      const changes = m.changes as Record<string, { from: unknown; to: unknown }> | undefined;
      if (!changes) return null;
      const entries = Object.entries(changes);
      if (entries.length === 0) return "(no field changes — tags only)";
      return entries
        .map(([k, v]) => `${k}: ${String(v.from)} → ${String(v.to)}`)
        .join(", ");
    }
    case "user.role_change": {
      const from = m.from as string | null | undefined;
      const to = m.to as string | undefined;
      return from && to ? `${from} → ${to}` : null;
    }
    case "exclusion.exclude": {
      const reason = m.reason as string | undefined;
      return reason ? `Reason: ${reason}` : null;
    }
    case "upload.commit": {
      const platform = m.platform as string | undefined;
      const rows = m.rowsImported as number | undefined;
      if (platform && rows !== undefined) return `${platform} · ${rows} rows`;
      return null;
    }
    case "upload.rollback": {
      const rows = m.rowsDeleted as number | undefined;
      return rows !== undefined ? `Removed ${rows} rows` : null;
    }
    case "mapping.add":
    case "mapping.remove": {
      const platform = m.platform as string | undefined;
      const field = m.internalField as string | undefined;
      const header = m.headerName as string | undefined;
      if (platform && field && header) return `${platform} · ${field} ← "${header}"`;
      return null;
    }
    case "auth.signin_failed": {
      const reason = m.reason as string | undefined;
      return reason ? `(${reason.replace(/_/g, " ")})` : null;
    }
    default:
      return null;
  }
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name?.trim() || email?.trim() || "?").split(/[\s@]+/).slice(0, 2);
  return src.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function AuditFeed({ rows, compact = false }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No activity yet.</p>
      </div>
    );
  }

  return (
    <ol className="space-y-1">
      {rows.map((row) => {
        const href = entityHref(row);
        const summary = metaSummary(row);
        const category = row.entityType as AuditEntityType;

        const actorBlock = compact ? null : row.actor ? (
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="w-6 h-6 rounded-full bg-surface-2 border border-line text-[10px] flex items-center justify-center text-ink-2"
              aria-hidden
            >
              {initials(row.actor.name, row.actor.email)}
            </div>
            <div className="leading-tight">
              <div className="text-[12px] text-ink">{row.actor.name || row.actor.email}</div>
              <div className="text-[10px] text-ink-3 font-mono">{row.actor.email}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="w-6 h-6 rounded-full border border-dashed border-line text-[10px] flex items-center justify-center text-ink-3"
              aria-hidden
              title="System / anonymous event"
            >
              ?
            </div>
            <div className="text-[12px] text-ink-3">System</div>
          </div>
        );

        return (
          <li
            key={row.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-line bg-surface hover:bg-surface-2/50 transition-colors"
          >
            {actorBlock}
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-2">
                <span
                  className={`inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] border ${categoryColor(category)}`}
                >
                  <ActionIcon action={row.action} />
                  {AUDIT_LABELS[row.action] ?? row.action}
                </span>
                {row.entityLabel &&
                  (href ? (
                    <Link
                      href={href}
                      className="font-mono text-[12px] text-ink hover:text-brand transition-colors truncate"
                    >
                      {row.entityLabel}
                    </Link>
                  ) : (
                    <span className="font-mono text-[12px] text-ink-2 truncate">
                      {row.entityLabel}
                    </span>
                  ))}
              </div>
              {summary && (
                <div className="text-[11px] text-ink-3 mt-0.5 truncate">{summary}</div>
              )}
            </div>
            <time
              className="text-[11px] text-ink-3 num shrink-0 tabular-nums"
              dateTime={row.at.toISOString()}
              title={row.at.toISOString()}
            >
              {relativeTime(row.at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
