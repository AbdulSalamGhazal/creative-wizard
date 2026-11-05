import type { VersionData } from "@/price-structure/engine/types";

/**
 * The three-way merge behind autosave (brief §7): when a save is refused
 * because another tab or person saved first, the client re-applies its own
 * pending edits ON TOP of the server copy — but only where the server copy is
 * untouched since the client's base. Anything else takes the server copy and
 * says so. Pure, so the rule is testable without a browser.
 *
 * Edits are addressed by SECTION, not by array index: a product is found by
 * its id wherever it sits, so a reorder in one tab doesn't make a CPA edit in
 * another land on the wrong product.
 *
 *   name · notes · data.settings · data.roasTargetId · data.activePlanId
 *   data.targets                      (the whole list — it is small and edited as one)
 *   data.products.order               (the ids, in order)
 *   data.products.<id>                (one product, offers included)
 *   data.plans.order / data.plans.<id>
 *   data.actuals.order / data.actuals.<id>
 */
export interface VersionDoc {
  name: string;
  notes: string;
  data: VersionData;
}

type Listed = "products" | "plans" | "actuals";
const LISTED: readonly Listed[] = ["products", "plans", "actuals"];

function parse(path: string): { kind: "field"; key: "name" | "notes" } | { kind: "data"; key: "settings" | "roasTargetId" | "activePlanId" | "targets" } | { kind: "order"; list: Listed } | { kind: "item"; list: Listed; id: string } | null {
  if (path === "name" || path === "notes") return { kind: "field", key: path };
  const parts = path.split(".");
  if (parts[0] !== "data") return null;
  const key = parts[1];
  if (key === "settings" || key === "roasTargetId" || key === "activePlanId" || key === "targets") {
    return { kind: "data", key };
  }
  if ((LISTED as readonly string[]).includes(key ?? "") && parts.length === 3) {
    const list = key as Listed;
    return parts[2] === "order" ? { kind: "order", list } : { kind: "item", list, id: parts[2]! };
  }
  return null;
}

export function sectionGet(doc: VersionDoc, path: string): unknown {
  const p = parse(path);
  if (!p) return undefined;
  switch (p.kind) {
    case "field":
      return doc[p.key];
    case "data":
      return doc.data[p.key];
    case "order":
      return (doc.data[p.list] as ReadonlyArray<{ id: string }>).map((x) => x.id);
    case "item":
      return (doc.data[p.list] as ReadonlyArray<{ id: string }>).find((x) => x.id === p.id);
  }
}

/** Return a new doc with the section replaced by `value` (an absent item is appended; `undefined` removes it). */
export function sectionSet(doc: VersionDoc, path: string, value: unknown): VersionDoc {
  const p = parse(path);
  if (!p) return doc;
  switch (p.kind) {
    case "field":
      return { ...doc, [p.key]: value as string };
    case "data":
      return { ...doc, data: { ...doc.data, [p.key]: value } };
    case "order": {
      const ids = value as string[];
      const list = doc.data[p.list] as Array<{ id: string }>;
      const byId = new Map(list.map((x) => [x.id, x]));
      const ordered = ids.map((id) => byId.get(id)).filter((x): x is { id: string } => x !== undefined);
      for (const x of list) if (!ids.includes(x.id)) ordered.push(x);
      return { ...doc, data: { ...doc.data, [p.list]: ordered } };
    }
    case "item": {
      const list = doc.data[p.list] as Array<{ id: string }>;
      if (value === undefined) {
        return { ...doc, data: { ...doc.data, [p.list]: list.filter((x) => x.id !== p.id) } };
      }
      const idx = list.findIndex((x) => x.id === p.id);
      const next = idx >= 0 ? list.map((x, i) => (i === idx ? value : x)) : [...list, value];
      return { ...doc, data: { ...doc.data, [p.list]: next } };
    }
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return Number.isNaN(a as number) && Number.isNaN(b as number);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export type MergeOutcome =
  /** Every pending section was untouched on the server: here is server + ours. */
  | { kind: "reapplied"; doc: VersionDoc }
  /** The server changed something we also changed: take the server copy. */
  | { kind: "server"; conflicting: string[] };

/**
 * `base` is the last copy the server acknowledged, `local` the client's
 * current copy, `server` the live row that beat us, `paths` the sections the
 * client changed since `base`.
 */
export function mergeOnConflict(
  base: VersionDoc,
  local: VersionDoc,
  server: VersionDoc,
  paths: readonly string[],
): MergeOutcome {
  const conflicting = paths.filter((p) => !deepEqual(sectionGet(base, p), sectionGet(server, p)));
  if (conflicting.length > 0) return { kind: "server", conflicting };
  let doc = server;
  for (const p of paths) doc = sectionSet(doc, p, sectionGet(local, p));
  return { kind: "reapplied", doc };
}
