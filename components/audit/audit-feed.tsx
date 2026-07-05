import Link from "next/link";
import {
  Building2,
  Clock,
  GitBranch,
  Images,
  Layers3,
  LogIn,
  LogOut,
  Package,
  ShieldAlert,
  SlidersHorizontal,
  Tags,
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
import { PLATFORM_LABEL } from "@/lib/palette";

const platformLabel = (p: string): string =>
  (PLATFORM_LABEL as Record<string, string>)[p] ?? p;

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

// Human phrasing for a single field change in a creative.update event.
function describeChange(field: string, c: { from: unknown; to: unknown }): string {
  switch (field) {
    case "name":
      return `renamed ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
    case "type":
      return `type ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
    case "productId":
      return "product reassigned";
    case "thumbnailUrl":
      return c.to ? "thumbnail added" : "thumbnail removed";
    case "launchDate":
      return `launch date ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
    default:
      return `${field} ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
  }
}

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
    "tag.create": Tags,
    "tag.rename": Tags,
    "tag.delete": Tags,
    "rating.update": SlidersHorizontal,
    "auth.signin": LogIn,
    "auth.signin_failed": ShieldAlert,
    "auth.signout": LogOut,
    "auth.password_change": ShieldAlert,
    "account.create": Building2,
    "account.rename": Building2,
    "account.window_update": Clock,
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
    case "account":
      return "border-brand/40 text-brand bg-brand/10";
    default:
      return "border-line-2 text-ink-3 bg-surface-2";
  }
}

function metaSummary(row: AuditFeedRow): string | null {
  const m = row.meta;
  if (!m) return null;
  const join = (parts: Array<string | null | undefined | false>) => {
    const s = parts.filter(Boolean) as string[];
    return s.length ? s.join(" · ") : null;
  };
  switch (row.action) {
    case "creative.create": {
      const type = m.type as string | undefined;
      const tags = (m.tags as string[] | undefined) ?? [];
      return join([type, tags.length ? plural(tags.length, "tag") : null]);
    }
    case "creative.bulk_create": {
      const count = m.count as number | undefined;
      const names = (m.names as string[] | undefined) ?? [];
      const preview = names.slice(0, 5).join(", ");
      return count
        ? `${plural(count, "creative")}${preview ? ` · ${preview}${names.length > 5 ? "…" : ""}` : ""}`
        : null;
    }
    case "creative.update": {
      const term = m.termination as
        | { platform: string; terminated: boolean }
        | undefined;
      if (term) {
        return `${term.terminated ? "terminated" : "reactivated"} on ${platformLabel(term.platform)}`;
      }
      const changes =
        (m.changes as Record<string, { from: unknown; to: unknown }> | undefined) ?? {};
      const parts = Object.entries(changes).map(([k, v]) => describeChange(k, v));
      const tagsCount = m.tagsCount as number | undefined;
      if (tagsCount !== undefined) parts.push(`tags set (${tagsCount})`);
      return parts.length ? parts.join(" · ") : null;
    }
    case "creative.notes_update": {
      const len = m.length as number | undefined;
      if (len === undefined) return null;
      return len > 0 ? `notes set (${len} chars)` : "notes cleared";
    }
    case "creative.source_update":
      return (m.set as boolean | undefined) ? "source link set" : "source link removed";
    case "creative.bulk_status": {
      const count = m.count as number | undefined;
      const status = m.status as string | undefined;
      return count && status ? `${count} → ${status}` : null;
    }
    case "creative.delete": {
      const n = m.recordsDeleted as number | undefined;
      return n !== undefined ? `removed with ${plural(n, "record")}` : null;
    }
    case "exclusion.exclude": {
      const platform = m.platform as string | undefined;
      const reason = m.reason as string | undefined;
      return join([
        platform ? platformLabel(platform) : null,
        m.date as string | undefined,
        reason ? `reason: ${reason}` : null,
      ]);
    }
    case "exclusion.include": {
      const platform = m.platform as string | undefined;
      return join([
        platform ? platformLabel(platform) : null,
        m.date as string | undefined,
      ]);
    }
    case "upload.commit": {
      const platform = m.platform as string | undefined;
      const imp = m.rowsImported as number | undefined;
      const upd = m.rowsUpdated as number | undefined;
      const upsert = m.upsert as boolean | undefined;
      const creatives = m.creatives as number | undefined;
      const dr = m.dateRange as { from?: string; to?: string } | null | undefined;
      return join([
        platform ? platformLabel(platform) : null,
        imp !== undefined ? `${imp} imported` : null,
        upsert && upd ? `${upd} updated` : null,
        creatives ? plural(creatives, "creative") : null,
        dr?.from && dr?.to ? `${dr.from} → ${dr.to}` : null,
      ]);
    }
    case "upload.rollback": {
      const n = m.rowsDeleted as number | undefined;
      const platform = m.platform as string | undefined;
      return join([
        platform ? platformLabel(platform) : null,
        n !== undefined ? `removed ${plural(n, "row")}` : null,
      ]);
    }
    case "upload.bulk_delete": {
      const n = m.deleted as number | undefined;
      const creatives = m.creatives as number | undefined;
      const span = m.dateSpan as string | null | undefined;
      return join([
        n !== undefined ? plural(n, "record") : null,
        creatives ? plural(creatives, "creative") : null,
        span,
      ]);
    }
    case "product.create": {
      const slug = m.slug as string | undefined;
      return slug ? `slug: ${slug}` : null;
    }
    case "mapping.add":
    case "mapping.remove": {
      const platform = m.platform as string | undefined;
      const field = m.internalField as string | undefined;
      const header = m.headerName as string | undefined;
      return platform && field && header
        ? `${platformLabel(platform)} · ${field} ← "${header}"`
        : null;
    }
    case "user.invite":
      return join([
        m.email as string | undefined,
        m.name as string | undefined,
        m.role as string | undefined,
      ]);
    case "rating.update": {
      const before = m.before as
        | { goodRoas?: number; decentRoas?: number; minSpend?: number }
        | null
        | undefined;
      if (!before) return "thresholds set";
      return `was Good ≥ ${before.goodRoas}×, Decent ≥ ${before.decentRoas}×, min $${before.minSpend}`;
    }
    case "user.role_change": {
      const from = m.from as string | null | undefined;
      const to = m.to as string | undefined;
      return to ? `${from ?? "—"} → ${to}` : null;
    }
    case "auth.signin":
      return (m.email as string | undefined) ?? null;
    case "auth.signin_failed": {
      const reason = m.reason as string | undefined;
      return join([
        m.email as string | undefined,
        reason ? `(${reason.replace(/_/g, " ")})` : null,
      ]);
    }
    case "tag.rename": {
      const from = m.from as string | undefined;
      const to = m.to as string | undefined;
      return from && to ? `${from} → ${to}` : null;
    }
    case "tag.delete": {
      const n = m.removedFromCreatives as number | undefined;
      return n !== undefined ? `removed from ${plural(n, "creative")}` : null;
    }
    case "view.create":
    case "view.delete": {
      const page = m.page as string | undefined;
      return page ? `page: ${page}` : null;
    }
    case "view.set_default": {
      const page = m.page as string | undefined;
      return page ? `${page} · default ${(m.default as boolean) ? "on" : "off"}` : null;
    }
    case "account.create": {
      const slug = m.slug as string | undefined;
      return slug ? `slug: ${slug}` : null;
    }
    case "account.rename": {
      const from = m.from as string | null | undefined;
      const to = m.to as string | undefined;
      return to ? `${from ?? "—"} → ${to}` : null;
    }
    case "account.window_update": {
      const from = m.fromHours as number | null | undefined;
      const to = m.toHours as number | undefined;
      return to !== undefined ? `${from != null ? `${from}h` : "—"} → ${to}h` : null;
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
              <div className="text-xs text-ink">{row.actor.name || row.actor.email}</div>
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
            <div className="text-xs text-ink-3">System</div>
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
                      className="font-mono text-xs text-ink hover:text-brand transition-colors truncate"
                    >
                      {row.entityLabel}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-ink-2 truncate">
                      {row.entityLabel}
                    </span>
                  ))}
              </div>
              {summary && (
                <div className="text-[11px] text-ink-3 mt-0.5 break-words">{summary}</div>
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
