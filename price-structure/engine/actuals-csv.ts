import { newId } from "./ids";
import { orderKey, type ActualPeriod, type Product } from "./types";

/**
 * The actuals CSV template and its upload parser (brief §9.2).
 *
 * The TEMPLATE is UTF-8 with a BOM (so Excel shows Arabic), CRLF, comma-
 * separated. The UPLOAD is forgiving: `;` or `,`, quoted cells, a BOM,
 * lowercase or re-spaced names, Arabic-Indic digits, "$12,500", "12,5".
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The calendar month before `today`: its name, year and length in days. */
export function previousMonth(today: Date): { name: string; days: number; monthName: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const prevY = m === 0 ? y - 1 : y;
  const prevM = m === 0 ? 11 : m - 1;
  const monthName = MONTHS[prevM]!;
  return { monthName, name: `${monthName} ${prevY}`, days: new Date(prevY, prevM + 1, 0).getDate() };
}

function quoteCell(v: string): string {
  return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The template's file name: `actuals-template-{previous-month-name}.csv`. */
export function templateFileName(today: Date): string {
  return `actuals-template-${previousMonth(today).monthName.toLowerCase()}.csv`;
}

export function actualsTemplate(products: readonly Product[], today: Date): string {
  const prev = previousMonth(today);
  const rows: string[][] = [
    [
      "Actuals template",
      "Fill in the values, save as CSV and upload it on the Plan page. Orders = placed orders.",
    ],
    ["Period name", prev.name],
    ["Days in period", String(prev.days)],
    ["Ad spend (USD)", ""],
    ["Meta reported ROAS (optional)", ""],
    ["Delivery rate % (optional)", ""],
    [],
    ["Product", "Offer", "Orders", "Product ID", "Offer ID"],
  ];
  for (const p of products) for (const o of p.offers) rows.push([p.name, o.name, "", p.id, o.id]);
  return "﻿" + rows.map((r) => r.map(quoteCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Split CSV text into rows of cells. Delimiter: `;` when the file has more
 * semicolons than commas, else `,`. Handles quotes, `""` escapes, CRLF/LF and
 * a leading BOM.
 */
export function splitCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const semis = (src.match(/;/g) ?? []).length;
  const commas = (src.match(/,/g) ?? []).length;
  const delim = semis > commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** trim · lowercase · collapse spaces. */
export function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARABIC_INDIC = /[٠-٩]/g;

/**
 * Numbers as people type them (brief §9.2): Arabic-Indic digits become 0–9;
 * everything but digits, `.`, `,` and `-` is dropped; a trailing `,` + 1–2
 * digits with no `.` is a decimal comma ("12,5"); otherwise commas group
 * thousands ("$3,400.50"). Empty → null.
 */
export function parseLooseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[^0-9.,-]/g, "");
  if (s === "" || s === "-" ) return null;
  if (!s.includes(".") && /,\d{1,2}$/.test(s)) {
    const idx = s.lastIndexOf(",");
    s = s.slice(0, idx).replace(/,/g, "") + "." + s.slice(idx + 1);
  } else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type ParsedActuals =
  | { ok: true; period: ActualPeriod; warnings: string[]; matched: number }
  | { ok: false; error: string };

const UPLOADED_NAME = "Uploaded period";

/**
 * Turn the rows of an uploaded file (CSV split here, or a workbook's first
 * sheet converted to strings elsewhere) into an actual period for `products`.
 */
export function parseActualRows(rows: readonly (readonly string[])[], products: readonly Product[]): ParsedActuals {
  const cell = (r: readonly string[], i: number) => (r[i] ?? "").trim();
  const headerIdx = rows.findIndex(
    (r) => normName(cell(r, 0)) === "product" && normName(cell(r, 1)) === "offer",
  );
  if (headerIdx < 0) {
    return { ok: false, error: 'Could not find the "Product, Offer, Orders" header row. Start from the template.' };
  }
  const header = rows[headerIdx]!.map((h) => normName(h));
  const ordersCol = header.indexOf("orders");
  if (ordersCol < 0) return { ok: false, error: 'The header row has no "Orders" column.' };
  const productIdCol = header.indexOf("product id");
  const offerIdCol = header.indexOf("offer id");

  let name = UPLOADED_NAME;
  let days: number | null = null;
  let adSpendUsd: number | null = null;
  let metaRoas: number | null = null;
  let deliveryRate: number | null = null;
  for (const r of rows.slice(0, headerIdx)) {
    const key = normName(cell(r, 0));
    const value = cell(r, 1);
    if (key === "") continue;
    if (key.startsWith("period")) {
      if (value !== "") name = value;
    } else if (key.startsWith("days")) {
      const n = parseLooseNumber(value);
      if (n !== null && n > 0) days = Math.round(n);
    } else if (key.includes("ad spend")) adSpendUsd = parseLooseNumber(value);
    else if (key.includes("roas")) metaRoas = parseLooseNumber(value);
    else if (key.includes("delivery")) {
      const n = parseLooseNumber(value);
      if (n !== null) deliveryRate = n > 1 ? n / 100 : n;
    }
  }

  const warnings: string[] = [];
  if (days === null) {
    days = 30;
    warnings.push('No "Days in period" found, so 30 days is assumed.');
  }
  if (adSpendUsd === null) {
    adSpendUsd = 0;
    warnings.push("No ad spend found. Enter it below to compare ROAS.");
  }

  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of products) {
    for (const o of p.offers) {
      const key = orderKey(p.id, o.id);
      byId.set(key, key);
      byName.set(`${normName(p.name)}\u0001${normName(o.name)}`, key);
    }
  }

  const orders: Record<string, number> = {};
  let matched = 0;
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const fileRow = headerIdx + 2 + i;
    if (r.every((c) => c.trim() === "")) return;
    const n = parseLooseNumber(cell(r, ordersCol));
    if (n === null || n === 0) return;
    const productName = cell(r, 0);
    const offerName = cell(r, 1);
    let key: string | undefined;
    if (productIdCol >= 0 && offerIdCol >= 0) {
      const pid = cell(r, productIdCol);
      const oid = cell(r, offerIdCol);
      if (pid && oid) key = byId.get(orderKey(pid, oid));
    }
    key ??= byName.get(`${normName(productName)}\u0001${normName(offerName)}`);
    if (!key) {
      warnings.push(
        `Row ${fileRow}: "${productName} · ${offerName}" doesn't match any product and offer, so it was skipped.`,
      );
      return;
    }
    orders[key] = (orders[key] ?? 0) + Math.max(0, n);
    matched++;
  });
  if (matched === 0) return { ok: false, error: "No orders found. Fill in the Orders column." };

  return {
    ok: true,
    matched: Object.keys(orders).length,
    warnings,
    period: {
      id: newId(),
      name,
      days,
      adSpendUsd: Math.max(0, adSpendUsd),
      metaRoas: metaRoas !== null && metaRoas > 0 ? metaRoas : null,
      deliveryRate: deliveryRate !== null && deliveryRate > 0 ? Math.min(1, deliveryRate) : null,
      orders,
    },
  };
}

/** "Enter by hand": a period named after the previous month, with its length. */
export function blankPeriod(today: Date): ActualPeriod {
  const prev = previousMonth(today);
  return { id: newId(), name: prev.name, days: prev.days, adSpendUsd: 0, metaRoas: null, deliveryRate: null, orders: {} };
}
