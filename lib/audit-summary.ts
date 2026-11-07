import { roas, usd0 } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";

/**
 * One muted line per audit event — what the `meta` jsonb says, in words.
 * A PLAIN module (2026-11-07), moved out of the audit feed so the server can
 * phrase an entity's Activity for the panel too; nothing here touches the
 * database. Shared by /admin/audit and every entity's Activity.
 */

export interface AuditSummaryInput {
  action: string;
  meta: Record<string, unknown> | null;
}

const platformLabel = (p: string): string =>
  (PLATFORM_LABEL as Record<string, string>)[p] ?? p;

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
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
    case "stages":
      return `stage ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
    default:
      return `${field} ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
  }
}

export function metaSummary(row: AuditSummaryInput): string | null {
  const m = row.meta;
  if (!m) return null;
  const join = (parts: Array<string | null | undefined | false>) => {
    const s = parts.filter(Boolean) as string[];
    return s.length ? s.join(" · ") : null;
  };
  // A string, not the AuditAction union: retired actions (LEGACY_AUDIT_LABELS)
  // still describe their old rows.
  switch (row.action as string) {
    case "creative.create": {
      const type = m.type as string | undefined;
      const angles = (m.angles as string[] | undefined) ?? [];
      return join([type, angles.length ? plural(angles.length, "angle") : null]);
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
      // Angle names since 2026-11; older rows only ever said how many.
      const added = (m.anglesAdded as string[] | undefined) ?? [];
      const removed = (m.anglesRemoved as string[] | undefined) ?? [];
      if (added.length) parts.push(`added angle${added.length > 1 ? "s" : ""} ${added.join(", ")}`);
      if (removed.length)
        parts.push(`removed angle${removed.length > 1 ? "s" : ""} ${removed.join(", ")}`);
      const anglesCount = m.anglesCount as number | undefined;
      if (anglesCount !== undefined && !added.length && !removed.length && m.anglesAdded === undefined)
        parts.push(`angles set (${anglesCount})`);
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
    case "campaign.create": {
      const platform = m.platform as string | undefined;
      return join([platform ? platformLabel(platform) : null, m.objective as string | undefined]);
    }
    case "campaign.update": {
      const renamed = m.renamedFrom as string | undefined;
      const objFrom = m.objectiveChangedFrom as string | undefined;
      const platFrom = m.platformChangedFrom as string | undefined;
      return join([
        renamed ? `renamed from ${renamed}` : null,
        objFrom ? `objective ${objFrom} → ${fmtVal(m.objective)}` : null,
        platFrom
          ? `platform ${platformLabel(platFrom)} → ${platformLabel(String(m.platform ?? ""))}`
          : null,
      ]);
    }
    case "campaign.delete": {
      const n = m.recordsDeleted as number | undefined;
      return n !== undefined ? `removed with ${plural(n, "record")}` : null;
    }
    case "exclusion.rule_create": {
      const n = m.excluded as number | undefined;
      const note = m.note as string | null | undefined;
      return join([
        m.kind as string | undefined,
        n !== undefined ? `excluded ${plural(n, "record")}` : null,
        note ? `note: ${note}` : null,
      ]);
    }
    case "exclusion.rule_toggle": {
      const n = m.affected as number | undefined;
      return join([
        (m.active as boolean | undefined) ? "turned on" : "turned off",
        n !== undefined ? plural(n, "record") : null,
      ]);
    }
    case "exclusion.rule_delete": {
      const n = m.restored as number | undefined;
      return n !== undefined ? `re-included ${plural(n, "record")}` : null;
    }
    case "budget.update": {
      const op = m.op as string | undefined;
      const total = m.plannedSpendTotal as number | undefined;
      const note = m.note as string | null | undefined;
      const opWord: Record<string, string> = {
        save: "plan saved",
        upload: "plan uploaded",
        delete: "plan deleted",
        convert: "converted to a curve",
        copy_from: `copied from ${fmtVal(m.from)}`,
        restore: "restored an earlier version",
        rate: `USD→SAR rate ${fmtVal(m.rate)}`,
      };
      return join([
        op ? (opWord[op] ?? op) : null,
        total !== undefined && op !== "delete" ? `spend ${usd0(total)}` : null,
        note ? `note: ${note}` : null,
      ]);
    }
    case "price_structure.version_edit": {
      const sections = (m.sections as string[] | undefined) ?? [];
      return sections.length ? sections.join(", ") : null;
    }
    case "price_structure.version_create":
    case "price_structure.version_import": {
      const from = m.from as string | undefined;
      const n = m.products as number | undefined;
      return join([
        from && from !== "bootstrap" ? `from ${from}` : null,
        n !== undefined ? plural(n, "product") : null,
      ]);
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
    case "landing_page.create":
    case "landing_page.delete": {
      const code = m.code as string | undefined;
      return code ? `@${code}` : null;
    }
    case "landing_page.update": {
      const changed = (m.changed as string[] | undefined) ?? [];
      return changed.length ? `changed ${changed.join(", ")}` : null;
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
      return `was Good ≥ ${roas(before.goodRoas)}, Decent ≥ ${roas(before.decentRoas)}, min ${usd0(before.minSpend)}`;
    }
    case "user.remove": {
      const kept = m.kept as { creatives?: number; uploads?: number; comments?: number } | undefined;
      if (!kept) return null;
      return `kept ${plural(kept.creatives ?? 0, "creative")}, ${plural(kept.uploads ?? 0, "upload")}, ${plural(kept.comments ?? 0, "comment")}`;
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
    case "angle.rename": {
      const from = m.from as string | undefined;
      const to = m.to as string | undefined;
      return from && to ? `${from} → ${to}` : null;
    }
    case "angle.delete": {
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

