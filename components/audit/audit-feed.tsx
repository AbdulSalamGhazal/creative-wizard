import Link from "next/link";
import {
  Building2,
  Clock,
  GitBranch,
  Images,
  Layers3,
  Link2,
  ListFilter,
  LogIn,
  LogOut,
  Package,
  ShieldAlert,
  SlidersHorizontal,
  Tags as AnglesIcon,
  Trash2,
  Upload,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";
import {
  auditLabel,
  type AuditAction,
  type AuditEntityType,
} from "@/lib/audit";
import type { AuditFeedRow } from "@/db/queries/audit";
import { UserAvatar } from "@/components/user/user-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { relativeTime } from "@/lib/format";
import { metaSummary } from "@/lib/audit-summary";
import { Chip } from "@/components/ui/chip";

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
  /** A category filter is on — the empty state then offers to clear it. */
  filtered?: boolean;
}

function entityHref(row: AuditFeedRow): string | null {
  switch (row.entityType) {
    case "creative":
      // entityLabel is the creative name we stored at write time.
      return row.entityLabel
        ? `/library/${encodeURIComponent(row.entityLabel)}`
        : null;
    case "upload":
      return "/uploads";
    case "product":
      return "/library?tab=products";
    case "landing_page":
      return "/library?tab=landing-pages";
    case "angle":
      return "/library?tab=angles";
    case "user":
      return "/admin/users";
    case "mapping":
      return "/uploads?tab=mapping";
    default:
      return null;
  }
}

function ActionIcon({ action }: { action: AuditAction }) {
  const map: Partial<Record<AuditAction, React.ComponentType<{ className?: string }>>> = {
    "creative.create": Images,
    "creative.update": Images,
    "creative.notes_update": Images,
    "exclusion.exclude": Trash2,
    "exclusion.include": GitBranch,
    "upload.commit": Upload,
    "upload.rollback": GitBranch,
    "product.create": Package,
    "product.archive": Package,
    "product.restore": Package,
    "landing_page.create": Link2,
    "landing_page.update": Link2,
    "landing_page.delete": Link2,
    "user.invite": UserPlus,
    "user.role_change": Users,
    "user.permissions_update": Users,
    "user.password_reset": ShieldAlert,
    "user.deactivate": UserX,
    "user.reactivate": UserCheck,
    "user.remove": UserMinus,
    "user.sessions_end": LogOut,
    "mapping.add": Layers3,
    "mapping.remove": Layers3,
    "angle.create": AnglesIcon,
    "angle.rename": AnglesIcon,
    "angle.delete": AnglesIcon,
    "rating.update": SlidersHorizontal,
    "auth.signin": LogIn,
    "auth.signin_failed": ShieldAlert,
    "auth.signout": LogOut,
    "auth.signout_everywhere": LogOut,
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

export function AuditFeed({ rows, compact = false, filtered = false }: Props) {
  if (rows.length === 0) {
    // Filtered to one category: say so, and offer the bar's own Clear (D24).
    return filtered ? (
      <EmptyState title="No activity in this category." kind="filters" />
    ) : (
      <EmptyState title="No activity yet." />
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
            {/* THE avatar (W3-4): photo, else the house initials + colour —
                the log had its own two-letter circle with no photo. */}
            <UserAvatar
              name={row.actor.name || row.actor.email}
              src={row.actor.avatarUrl}
              size="sm"
            />
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
            className="@container flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 rounded-md border border-line bg-surface hover:bg-surface-2/50 transition-colors"
          >
            {actorBlock}
            {/* A NARROW row (a phone, a docked comment panel) drops the action
                line under the actor and the time: three columns left it 98px,
                and a one-line chip like "Updated store source mapping" (180px)
                ran over the timestamp and out of the card. */}
            <div className="flex-1 min-w-0 @max-[28rem]:order-last @max-[28rem]:basis-full">
              <div className="flex items-center flex-wrap gap-2">
                {/* One line, always: in a phone's narrow column the chip
                    shrank and broke "Deleted a / view" out of its border (W3). */}
                <Chip className={`inline-flex shrink-0 whitespace-nowrap ${categoryColor(category)}`}>
                  <ActionIcon action={row.action} />
                  {auditLabel(row.action)}
                </Chip>
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
              className="ml-auto text-[11px] text-ink-3 shrink-0 tabular-nums"
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
