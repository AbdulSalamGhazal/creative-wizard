"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { newId } from "@/price-structure/engine/ids";
import { METRIC_LIST, METRICS } from "@/price-structure/engine/metrics";
import { eligibleRoasTargets } from "@/price-structure/engine/targets";
import type { MetricKey, Target } from "@/price-structure/engine/types";
import { NumberField } from "../fields";
import { RoasTargetPicker } from "../roas-target-picker";
import { SectionCard } from "../section-card";
import { useVersion } from "../version-provider";

const UNIT_LABEL = { pct: "%", sar: "SAR", x: "×", usd: "$" } as const;

/** "Your targets" (brief §6.3): a row per target — on/off, metric, A, B, remove. */
export function TargetsEditor() {
  const { open, updateData, access } = useVersion();
  if (!open) return null;
  const targets = open.data.targets;
  const setTargets = (fn: (t: Target[]) => Target[]) => updateData("data.targets", (d) => ({ ...d, targets: fn(d.targets) }));
  const patch = (id: string, p: Partial<Target>) => setTargets((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const add = () => setTargets((ts) => [...ts, { id: newId(), metric: "margin", a: 0.25, b: 0.35, enabled: true }]);
  const eligible = eligibleRoasTargets(targets);

  return (
    <SectionCard
      title="Your targets"
      info="Turn a target off to leave it out of the status column on the other pages."
      actions={
        access.edit ? (
          <Button type="button" size="sm" className="h-8 text-xs" onClick={add}>
            <Plus aria-hidden /> Add target
          </Button>
        ) : undefined
      }
      contentClassName="space-y-3"
    >
      <fieldset disabled={!access.edit} className="min-w-0 space-y-3">
      {targets.length === 0 ? (
        <p className="text-xs text-ink-3">No targets yet.</p>
      ) : (
        <ul className="space-y-2">
          {targets.map((t) => {
            const meta = METRICS[t.metric];
            const unit = UNIT_LABEL[meta.unit];
            const pct = meta.unit === "pct";
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2/30 p-2">
                <Switch checked={t.enabled} onCheckedChange={(v) => patch(t.id, { enabled: v })} aria-label={`${meta.label} target on`} />
                <div className="min-w-0 flex-1 basis-48">
                  <Select value={t.metric} onValueChange={(m) => patch(t.id, { metric: m as MetricKey })}>
                    <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label="Target metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRIC_LIST.map((m) => (
                        <SelectItem key={m.key} value={m.key}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-ink-2">
                    {meta.higherIsBetter ? "Higher is better: pass when value ≥ target" : "Lower is better: pass when value ≤ target"}
                  </p>
                </div>
                <label className="flex items-center gap-1 text-[11px] text-ink-3">
                  A · minimum
                  <NumberField value={t.a} pct={pct} unit={unit} ariaLabel="Target A" wrapperClassName="w-28" onChange={(v) => patch(t.id, { a: v })} />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-ink-3">
                  B · stretch
                  <NumberField value={t.b} pct={pct} unit={unit} ariaLabel="Target B" wrapperClassName="w-28" onChange={(v) => patch(t.id, { b: v })} />
                </label>
                <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove target" onClick={() => setTargets((ts) => ts.filter((x) => x.id !== t.id))}>
                  <X aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end text-[11px] text-ink-3">
        {eligible.length >= 2 ? (
          <RoasTargetPicker />
        ) : eligible.length === 1 ? (
          <span>ROAS for A / B across the app comes from your {METRICS[eligible[0]!.metric].label} target.</span>
        ) : (
          <span>Add a CML %, CML per order or CML per unit target to see the ROAS for A / B across the app.</span>
        )}
      </div>
      </fieldset>
    </SectionCard>
  );
}
