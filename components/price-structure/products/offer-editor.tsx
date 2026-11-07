"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, CopyPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { evaluateOffer } from "@/price-structure/engine/evaluate";
import { convertMechanic, MECHANIC_KIND_LABEL, MECHANIC_KINDS, mechanicText } from "@/price-structure/engine/mechanics";
import { METRICS, statusAgainst } from "@/price-structure/engine/metrics";
import { isRoasTargetMetric, resolveRoasTarget, roasNeeded } from "@/price-structure/engine/targets";
import type { AdMode, Mechanic, MechanicKind, Offer, Product, VersionData } from "@/price-structure/engine/types";
import { formatMetric, money2, pct1, roas2, targetText, usd2 } from "@/price-structure/format";
import { ConfirmDialog } from "../confirm-dialog";
import { Field, NumberField } from "../fields";
import { Num } from "../num";
import { StatusBadge } from "../status-badge";
import { Chip } from "@/components/ui/chip";

/**
 * One offer's editor block (brief §6.2): header (number, name, mechanic chip,
 * a status badge per enabled target, ↑ ↓ Duplicate Delete), inputs on the
 * left, the results grid on the right. Clicking or focusing inside selects it.
 */
export function OfferEditor({
  index,
  count,
  product,
  offer,
  data,
  selected,
  onSelect,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  readOnly = false,
}: {
  index: number;
  count: number;
  product: Product;
  offer: Offer;
  data: VersionData;
  selected: boolean;
  onSelect: () => void;
  onChange: (fn: (o: Offer) => Offer) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  readOnly?: boolean;
}) {
  const ids = { name: useId(), type: useId(), coupon: useId(), cpa: useId(), roas: useId(), orders: useId(), own: useId(), rate: useId() };
  const [confirm, setConfirm] = useState(false);
  const settings = data.settings;
  const r = evaluateOffer(product, offer, settings);
  const enabled = data.targets.filter((t) => t.enabled);
  const roasTarget = resolveRoasTarget(data.targets, data.roasTargetId);
  const needed =
    roasTarget && isRoasTargetMetric(roasTarget.metric)
      ? {
          a: roasNeeded(r, roasTarget.metric, roasTarget.a, settings.usdToSar),
          b: roasNeeded(r, roasTarget.metric, roasTarget.b, settings.usdToSar),
          text: `${targetText(roasTarget.metric, roasTarget.a)} / ${targetText(roasTarget.metric, roasTarget.b)}`,
        }
      : null;

  const set = <K extends keyof Offer>(key: K, value: Offer[K]) => onChange((o) => ({ ...o, [key]: value }));
  const setMechanic = (fn: (m: Mechanic) => Mechanic) => onChange((o) => ({ ...o, mechanic: fn(o.mechanic) }));
  const setKind = (kind: MechanicKind) => onChange((o) => ({ ...o, mechanic: convertMechanic(o.mechanic, kind, product.price) }));
  const setAdMode = (mode: AdMode) => {
    if (mode === offer.adMode) return;
    // Switching converts the value so the ad spend stays the same.
    if (mode === "roas") {
      const roas = r.adSpend > 0 ? Math.round((r.paidGross / r.adSpend) * 100) / 100 : offer.platformRoas;
      onChange((o) => ({ ...o, adMode: "roas", platformRoas: Math.max(0.01, roas) }));
    } else {
      const cpa = Math.round((r.adSpend / settings.usdToSar) * 100) / 100;
      onChange((o) => ({ ...o, adMode: "cpa", cpaUsd: cpa }));
    }
  };

  const m = offer.mechanic;
  const text = mechanicText(m);

  return (
    <section
      id={`offer-${offer.id}`}
      aria-label={`Offer ${index + 1}: ${offer.name}`}
      onClick={onSelect}
      onFocusCapture={onSelect}
      className={cn(
        "rounded-lg border bg-surface-2/30 p-3 transition-colors",
        selected ? "border-brand/60 ring-1 ring-brand/30" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums text-xs text-ink-3">{index + 1}</span>
        <input
          id={ids.name}
          aria-label="Offer name"
          dir="auto"
          value={offer.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Offer name"
          className="h-7 min-w-0 flex-1 basis-40 rounded-md border border-transparent bg-transparent px-1 text-sm font-medium text-ink outline-none transition-colors hover:border-line focus:border-brand"
        />
        <Chip title="Mechanic">{text}</Chip>
        {enabled.map((t) => {
          const s = statusAgainst(r, t);
          return (
            <span key={t.id} className="inline-flex items-center gap-1 text-[11px] text-ink-3">
              {METRICS[t.metric].short}
              <StatusBadge
                status={s}
                compact
                title={`${METRICS[t.metric].label}: A ${formatMetric(t.metric, t.a)}, B ${formatMetric(t.metric, t.b)}`}
              />
            </span>
          );
        })}
        {!readOnly && (
        <span className="ml-auto flex items-center gap-0.5">
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp aria-hidden />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown aria-hidden />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Duplicate offer" title="Duplicate" onClick={onDuplicate}>
            <CopyPlus aria-hidden />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Delete offer" title="Delete" className="text-neg hover:text-neg" onClick={() => setConfirm(true)}>
            <Trash2 aria-hidden />
          </Button>
        </span>
        )}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* ── Inputs ─────────────────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Offer type" htmlFor={ids.type} className="sm:col-span-2">
            <Select value={m.kind} onValueChange={(v) => setKind(v as MechanicKind)}>
              <SelectTrigger id={ids.type} size="sm" className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MECHANIC_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {MECHANIC_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {m.kind === "percent" && (
            <>
              <Field label="Discount %">
                <NumberField value={m.pct} pct unit="%" min={0} max={100} ariaLabel="Discount %" onChange={(v) => setMechanic((x) => ({ ...x, kind: "percent", qty: (x as typeof m).qty, pct: v }))} />
              </Field>
              <Field label="Units per order">
                <NumberField value={m.qty} integer min={1} ariaLabel="Units per order" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), qty: v }))} />
              </Field>
            </>
          )}
          {m.kind === "amount" && (
            <>
              <Field label="Amount off">
                <NumberField value={m.amount} unit="SAR" min={0} ariaLabel="Amount off" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), amount: v }))} />
              </Field>
              <Field label="Units per order">
                <NumberField value={m.qty} integer min={1} ariaLabel="Units per order" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), qty: v }))} />
              </Field>
            </>
          )}
          {m.kind === "bxgy" && (
            <>
              <Field label="Buy">
                <NumberField value={m.buy} integer min={1} ariaLabel="Buy" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), buy: v }))} />
              </Field>
              <Field label="Get free">
                <NumberField value={m.get} integer min={1} ariaLabel="Get free" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), get: v }))} />
              </Field>
            </>
          )}
          {m.kind === "bxgy_pct" && (
            <>
              <Field label="Buy">
                <NumberField value={m.buy} integer min={1} ariaLabel="Buy" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), buy: v }))} />
              </Field>
              <Field label="Get">
                <NumberField value={m.get} integer min={1} ariaLabel="Get" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), get: v }))} />
              </Field>
              <Field label="Off the extra units %" className="sm:col-span-2">
                <NumberField value={m.pct} pct unit="%" min={0} max={100} ariaLabel="Off the extra units %" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), pct: v }))} />
              </Field>
            </>
          )}
          {m.kind === "bundle" && (
            <>
              <Field label="Units in bundle">
                <NumberField value={m.qty} integer min={1} ariaLabel="Units in bundle" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), qty: v }))} />
              </Field>
              <Field label="Bundle price">
                <NumberField value={m.price} unit="SAR" min={0} ariaLabel="Bundle price" onChange={(v) => setMechanic((x) => ({ ...(x as typeof m), price: v }))} />
              </Field>
            </>
          )}
          <Field label="Extra coupon / general discount" hint="On top of the offer" htmlFor={ids.coupon}>
            <NumberField id={ids.coupon} value={offer.couponDiscount} pct unit="%" min={0} max={100} onChange={(v) => set("couponDiscount", v)} />
          </Field>
          <Field label="Orders / month" hint="Placed orders, optional" htmlFor={ids.orders}>
            <NumberField id={ids.orders} value={offer.ordersPerMonth} integer min={0} onChange={(v) => set("ordersPerMonth", v)} />
          </Field>
          <div className="space-y-1 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-2">Ad cost input</span>
              <SegmentedControl<AdMode>
                ariaLabel="Ad cost input"
                value={offer.adMode}
                onChange={setAdMode}
                options={[
                  { value: "cpa", label: "CPA $" },
                  { value: "roas", label: "ROAS" },
                ]}
              />
            </div>
            {offer.adMode === "cpa" ? (
              <Field label="CPA per placed order" hint={`= ${money2(offer.cpaUsd * settings.usdToSar)} SAR`} htmlFor={ids.cpa}>
                <NumberField id={ids.cpa} value={offer.cpaUsd} unit="$" min={0} onChange={(v) => set("cpaUsd", v)} />
              </Field>
            ) : (
              <Field label="Platform ROAS" hint="As the ad platform reports it" htmlFor={ids.roas}>
                <NumberField id={ids.roas} value={offer.platformRoas} unit="×" min={0.01} onChange={(v) => set("platformRoas", v)} />
              </Field>
            )}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={ids.own} className="text-xs text-ink-2">
                Own delivery rate for this offer
              </label>
              <Switch
                id={ids.own}
                checked={offer.deliveryRateOverride !== null}
                onCheckedChange={(on) => set("deliveryRateOverride", on ? settings.deliveryRate : null)}
              />
            </div>
            {offer.deliveryRateOverride !== null ? (
              <NumberField
                id={ids.rate}
                ariaLabel="Delivery rate for this offer"
                value={offer.deliveryRateOverride}
                pct
                unit="%"
                min={1}
                max={100}
                onChange={(v) => set("deliveryRateOverride", v)}
              />
            ) : (
              <p className="text-[11px] text-ink-3">Using default rate {pct1(settings.deliveryRate)}</p>
            )}
          </div>
          {offer.notes && (
            <p className="rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-ink-2 sm:col-span-2" dir="auto">
              {offer.notes}
            </p>
          )}
        </div>

        {/* ── Results ────────────────────────────────────────────────────── */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 self-start rounded-md border border-line bg-surface p-3 text-xs 2xl:grid-cols-3">
          <Result label="Customer pays" title="What the customer pays for the order, incl. VAT, after all discounts."><Num value={r.paidGross} kind="money2" /></Result>
          <Result label="Net revenue" title="Customer pays minus VAT."><Num value={r.netRevenue} kind="money2" /></Result>
          <Result label="CML" title="Clean Money Left: net revenue − COGS − marketing − undelivered cost."><Num value={r.profit} kind="money2" /></Result>
          <Result label="CML %" title="CML ÷ net revenue."><Num value={r.margin} kind="pct2" /></Result>
          <Result label="CML / unit" title="CML ÷ units in the order."><Num value={r.profitPerUnit} kind="money2" /></Result>
          <Result label="Effective discount" title="List price − customer pays, as a share of list."><Num value={r.discount} kind="pct1" /></Result>
          <Result label="Platform ROAS" title="What the ad platform shows: customer pays ÷ ad spend per placed order."><Num value={r.platformRoas} kind="roas" /></Result>
          <Result label="Accountant ROAS" title="Net revenue (ex VAT, delivered) ÷ (marketing + undelivered cost)."><Num value={r.accountantRoas} kind="roas" /></Result>
          <Result label="Ad cost %" title="(marketing + undelivered cost) ÷ net revenue = 1 ÷ accountant ROAS."><Num value={r.adCostPct} kind="pct2" /></Result>
          <Result
            label="ROAS for A / B"
            title={needed ? `Platform ROAS needed for ${needed.text}` : "Set a CML target on the Targets page"}
          >
            {needed ? <span className="tabular-nums">{roas2(needed.a.roas)} / {roas2(needed.b.roas)}</span> : "—"}
          </Result>
          <Result label="Max CPA for A / B" title={needed ? `CPA per placed order allowed for ${needed.text}` : "Set a CML target on the Targets page"}>
            {needed ? <span className="tabular-nums">{usd2(needed.a.maxCpaUsd)} / {usd2(needed.b.maxCpaUsd)}</span> : "—"}
          </Result>
          <Result label="COGS %" title="Product cost ÷ net revenue."><Num value={r.cogsPct} kind="pct2" /></Result>
        </dl>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={
          <>
            Delete &ldquo;<span dir="auto">{offer.name}</span>&rdquo;?
          </>
        }
        description="Its share in every plan and its orders in every actual period go with it."
        confirmLabel="Delete offer"
        onConfirm={onDelete}
      />
    </section>
  );
}

function Result({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-[11px] leading-tight text-ink-3">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

