import { isMetricKey } from "./metrics";
import { newId } from "./ids";
import { evenShares } from "./shares";
import type { Settings, VersionData } from "./types";

/**
 * Version export (brief §9.1) and import of BOTH our export and the old
 * standalone tool's (§9.3). The import here is STRUCTURAL: it finds the five
 * settings, drops what the module has no home for (scenario levers, OPEX cost
 * lines, break-even targets) and shapes a candidate document. The candidate is
 * then validated by the Zod schema (`../schema.ts`) before anything is stored.
 */
export const EXPORT_FORMAT = "price-structure-module";
export const EXPORT_FORMAT_VERSION = 1;

export interface VersionExport extends VersionData {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  name: string;
  exportedAt: string;
}

export function toExport(name: string, data: VersionData, now: Date): VersionExport {
  return { format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION, name, exportedAt: now.toISOString(), ...data };
}

/** a–z, 0–9 and Arabic letters survive; everything else becomes a hyphen. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9ء-يٮ-ۓ]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function exportFileName(name: string, now: Date): string {
  const slug = slugify(name) || "version";
  return `price-structure-${slug}-${now.toISOString().slice(0, 10)}.json`;
}

export const IMPORT_ERROR = "This file does not look like a Price Structure export.";

export type ImportResult =
  | { ok: true; name: string | null; candidate: unknown; warnings: string[] }
  | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const SETTINGS_KEYS: ReadonlyArray<keyof Settings> = [
  "vatRate",
  "pricesIncludeVat",
  "usdToSar",
  "deliveryRate",
  "undeliveredCost",
];

const LEVER_LABELS: Record<string, string> = {
  priceChange: "price change",
  unitCostChange: "unit cost change",
  adCostChange: "ad cost change",
  extraDiscount: "extra discount",
};

function pickSettings(src: Record<string, unknown>): Record<string, unknown> | null {
  if (!SETTINGS_KEYS.every((k) => k in src)) return null;
  return Object.fromEntries(SETTINGS_KEYS.map((k) => [k, src[k]]));
}

/**
 * Shape an uploaded JSON document into a VersionData candidate. Accepts the
 * module's own export (settings at the top level) and the old tool's v4 export
 * (settings inside the active scenario's `assumptions`).
 */
export function importDocument(raw: unknown): ImportResult {
  if (!isRecord(raw) || !Array.isArray(raw.products)) return { ok: false, error: IMPORT_ERROR };
  const warnings: string[] = [];

  let settings: Record<string, unknown> | null = null;
  if (isRecord(raw.settings)) settings = pickSettings(raw.settings);
  if (!settings && Array.isArray(raw.scenarios)) {
    const scenarios = raw.scenarios.filter(isRecord);
    const active = scenarios.find((s) => s.id === raw.activeScenarioId) ?? scenarios[0];
    if (active && isRecord(active.assumptions)) {
      settings = pickSettings(active.assumptions);
      const levers = Object.keys(LEVER_LABELS).filter((k) => {
        const v = active.assumptions && isRecord(active.assumptions) ? active.assumptions[k] : 0;
        return typeof v === "number" && v !== 0;
      });
      if (levers.length > 0) {
        warnings.push(
          `Scenario adjustments (${levers.map((k) => LEVER_LABELS[k]).join(", ")}) were not imported; the module has no scenarios.`,
        );
      }
    }
  }
  if (!settings) return { ok: false, error: IMPORT_ERROR };

  const targets = Array.isArray(raw.targets) ? raw.targets.filter((t) => isRecord(t) && isMetricKey(t.metric)) : [];

  let plans = Array.isArray(raw.plans) ? raw.plans.filter(isRecord) : [];
  if (plans.length === 0) {
    const products = raw.products.filter(isRecord);
    const shares = evenShares(
      products.map((p) => ({
        id: String(p.id ?? ""),
        offers: Array.isArray(p.offers) ? p.offers.filter(isRecord).map((o) => ({ id: String(o.id ?? "") })) : [],
      })) as unknown as VersionData["products"],
    );
    plans = [{ id: newId(), name: "Base plan", ordersPerDay: 100, ...shares }];
  }
  const activePlanId =
    typeof raw.activePlanId === "string" && plans.some((p) => p.id === raw.activePlanId)
      ? raw.activePlanId
      : String(plans[0]!.id ?? "");

  const candidate = {
    settings,
    products: raw.products,
    targets,
    roasTargetId: typeof raw.roasTargetId === "string" ? raw.roasTargetId : "",
    plans,
    activePlanId,
    actuals: Array.isArray(raw.actuals) ? raw.actuals : [],
  };
  return { ok: true, name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null, candidate, warnings };
}
