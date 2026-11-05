"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import type { ActualPeriod, Settings } from "@/price-structure/engine/types";
import { pct1 } from "@/price-structure/format";
import { Field, NumberField, TextField } from "../fields";
import { SectionCard } from "../section-card";

/** "Period details" (brief §6.4): name, days, ad spend, Meta ROAS, the real delivery rate. */
export function PeriodDetails({ period, settings, onChange }: { period: ActualPeriod; settings: Settings; onChange: (fn: (p: ActualPeriod) => ActualPeriod) => void }) {
  const ids = { name: useId(), days: useId(), spend: useId(), meta: useId(), own: useId(), rate: useId() };
  const set = <K extends keyof ActualPeriod>(key: K, value: ActualPeriod[K]) => onChange((p) => ({ ...p, [key]: value }));
  return (
    <SectionCard title="Period details">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Name" htmlFor={ids.name}>
          <TextField id={ids.name} value={period.name} onChange={(v) => set("name", v)} />
        </Field>
        <Field label="Days" htmlFor={ids.days}>
          <NumberField id={ids.days} value={period.days} integer min={1} onChange={(v) => set("days", v)} />
        </Field>
        <Field label="Ad spend" hint="Whole period" htmlFor={ids.spend}>
          <NumberField id={ids.spend} value={period.adSpendUsd} unit="$" min={0} onChange={(v) => set("adSpendUsd", v)} />
        </Field>
        <Field label="Meta reported ROAS" hint="Optional, for reference" htmlFor={ids.meta}>
          <NumberField id={ids.meta} value={period.metaRoas ?? 0} unit="×" min={0} onChange={(v) => set("metaRoas", v > 0 ? v : null)} />
        </Field>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={ids.own} className="text-xs text-ink-2">
              Actual delivery rate
            </label>
            <Switch id={ids.own} checked={period.deliveryRate !== null} onCheckedChange={(on) => set("deliveryRate", on ? settings.deliveryRate : null)} />
          </div>
          {period.deliveryRate !== null ? (
            <NumberField id={ids.rate} ariaLabel="Actual delivery rate" value={period.deliveryRate} pct unit="%" min={1} max={100} onChange={(v) => set("deliveryRate", v)} />
          ) : (
            <p className="text-[11px] text-ink-3">Default {pct1(settings.deliveryRate)}</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
