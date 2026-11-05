"use client";

import { useId } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/price-structure/engine/types";
import { Field, NumberField } from "./fields";
import { useVersion } from "./version-provider";

/**
 * The Settings drawer (brief §6.0): the open version's five assumptions.
 * Every page recalculates as you type — the edits go straight through the
 * provider's autosave.
 */
export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { open: version, updateData } = useVersion();
  const ids = { vat: useId(), incl: useId(), fx: useId(), delivery: useId(), undelivered: useId() };
  const s = version?.data.settings;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    updateData("data.settings", (d) => ({ ...d, settings: { ...d.settings, [key]: value } }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(26rem,100vw)] overflow-y-auto sm:max-w-none">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            {version ? <span dir="auto">{version.name}</span> : "—"} · saved as you type
          </SheetDescription>
        </SheetHeader>
        {s && (
          <div className="space-y-5 px-4 pb-6">
            <Field label="VAT rate" htmlFor={ids.vat}>
              <NumberField id={ids.vat} value={s.vatRate} pct unit="%" min={0} max={100} onChange={(v) => set("vatRate", v)} />
            </Field>
            <Field label="Prices include VAT" htmlFor={ids.incl} inline>
              <Switch id={ids.incl} checked={s.pricesIncludeVat} onCheckedChange={(v) => set("pricesIncludeVat", v)} />
            </Field>
            <Field label="USD → SAR" hint="For CPA in dollars" htmlFor={ids.fx}>
              <NumberField id={ids.fx} value={s.usdToSar} unit="SAR" min={0.0001} onChange={(v) => set("usdToSar", v)} />
            </Field>
            <Field label="Delivery rate" hint="Placed orders that get delivered" htmlFor={ids.delivery}>
              <NumberField id={ids.delivery} value={s.deliveryRate} pct unit="%" min={1} max={100} onChange={(v) => set("deliveryRate", v)} />
            </Field>
            <Field label="Cost per undelivered order" hint="Shipping out and back, handling" htmlFor={ids.undelivered}>
              <NumberField id={ids.undelivered} value={s.undeliveredCost} unit="SAR" min={0} onChange={(v) => set("undeliveredCost", v)} />
            </Field>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
