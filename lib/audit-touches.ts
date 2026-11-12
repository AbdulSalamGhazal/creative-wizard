import { auditTouchEntityEnum, type AuditTouchEntity } from "@/lib/enums";

/**
 * What an audit event TOUCHED — the pure layer under `audit_event_entities`
 * (2026-11). A writer collects the creatives, campaigns and budget months its
 * action affected (resolved inside its own transaction, BEFORE any delete) and
 * hands them to `writeAudit({ touches })`; the per-entity Activity history
 * reads them back. Nothing here touches the database.
 */

export type AuditTouches = Partial<Record<AuditTouchEntity, readonly string[]>>;

/** One link row's identity, before the event id and account are stamped. */
export interface AuditTouchRow {
  entityType: AuditTouchEntity;
  entityId: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * A budget month's id is `YYYY-MM`. Accepts a month, a date or a timestamp
 * string (`2026-10`, `2026-10-01`, `2026-10-14T…`) or a Date, and returns the
 * month — or null for anything that isn't one.
 */
export function toBudgetMonth(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const s = value instanceof Date ? value.toISOString() : value;
  const m = s.slice(0, 7);
  return MONTH_RE.test(m) ? m : null;
}

/**
 * Flatten touches into link rows: blanks dropped, every id once per type, a
 * budget month normalised to `YYYY-MM` (an unparseable one is dropped rather
 * than stored as something the history would never match). Order is stable —
 * type order, then first appearance.
 */
export function touchRows(touches: AuditTouches | null | undefined): AuditTouchRow[] {
  if (!touches) return [];
  const out: AuditTouchRow[] = [];
  for (const entityType of auditTouchEntityEnum) {
    const seen = new Set<string>();
    for (const raw of touches[entityType] ?? []) {
      const id = entityType === "budget_month" ? toBudgetMonth(raw) : raw?.trim() || null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ entityType, entityId: id });
    }
  }
  return out;
}

/** Union of several touch sets (later duplicates are dropped by `touchRows`). */
export function mergeTouches(...sets: Array<AuditTouches | null | undefined>): AuditTouches {
  const out: Record<AuditTouchEntity, string[]> = {
    creative: [],
    campaign: [],
    budget_month: [],
    ps_version: [],
    landing_page: [],
  };
  for (const set of sets) {
    if (!set) continue;
    for (const t of auditTouchEntityEnum) out[t].push(...(set[t] ?? []));
  }
  return out;
}

/** A performance record's identity, as a DELETE/UPDATE … RETURNING yields it. */
export interface TouchedRecord {
  creativeId: string;
  campaignId: string;
  /** The record's day — present when the change moves a budget month's actuals. */
  date?: string | null;
}

/**
 * The creatives, campaigns and (when `months`) budget months a set of
 * performance records belongs to. `months` is true for paths that change
 * SPEND — inserting or deleting records (Budget's actuals read every record,
 * excluded or not) — and false for exclusions, which Budget ignores by design.
 */
export function touchesFromRecords(
  rows: readonly TouchedRecord[],
  opts: { months: boolean },
): AuditTouches {
  const creative = new Set<string>();
  const campaign = new Set<string>();
  const months = new Set<string>();
  for (const r of rows) {
    creative.add(r.creativeId);
    campaign.add(r.campaignId);
    if (opts.months) {
      const m = toBudgetMonth(r.date);
      if (m) months.add(m);
    }
  }
  return {
    creative: [...creative],
    campaign: [...campaign],
    ...(opts.months ? { budget_month: [...months] } : {}),
  };
}

/**
 * Collects touches across several statements of one transaction (an
 * exclusion rule's un-apply + re-sweep, say). Engine functions take an
 * optional collector and feed it the rows they flipped.
 */
export class TouchCollector {
  private readonly rows: TouchedRecord[] = [];
  constructor(private readonly opts: { months: boolean } = { months: false }) {}
  add(rows: readonly TouchedRecord[]): void {
    this.rows.push(...rows);
  }
  get size(): number {
    return this.rows.length;
  }
  touches(): AuditTouches {
    return touchesFromRecords(this.rows, this.opts);
  }
}

/**
 * The links an event makes to ITSELF: a creative or campaign event names its
 * own entity, a budget-plan event its month. Every other event links only
 * through the touches its writer passes.
 */
export function selfTouches(input: {
  action: string;
  entityType: string;
  entityId?: string | null;
}): AuditTouches {
  const id = input.entityId;
  if (!id) return {};
  if (input.entityType === "creative") return { creative: [id] };
  if (input.entityType === "campaign") return { campaign: [id] };
  // A Price Structure version (2026-11-07) — every price_structure.* event is
  // about the version it names.
  if (input.entityType === "price_structure") return { ps_version: [id] };
  // A landing page's own create / edit / delete (2026-11-12, its detail page).
  if (input.entityType === "landing_page") return { landing_page: [id] };
  if (input.entityType === "budget" && input.action === "budget.update") {
    const m = toBudgetMonth(id);
    return m ? { budget_month: [m] } : {};
  }
  return {};
}

/** Sorted, de-duplicated difference — what `next` has that `prev` doesn't. */
export function addedValues(prev: readonly string[], next: readonly string[]): string[] {
  const before = new Set(prev);
  return [...new Set(next)].filter((v) => !before.has(v)).sort();
}

/** Same values, ignoring order and repeats — "did this set change?" */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return addedValues(a, b).length === 0 && addedValues(b, a).length === 0;
}
