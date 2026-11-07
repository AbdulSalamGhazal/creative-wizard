"use client";

import { useId, useState } from "react";
import { CopyPlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Plan } from "@/price-structure/engine/types";
import { num2 } from "@/price-structure/format";
import { ConfirmDialog } from "../confirm-dialog";
import { Field, NumberField, TextField } from "../fields";

export type Period = "day" | "week" | "month";
export const PERIOD_MULT: Record<Period, number> = { day: 1, week: 7, month: 30 };
export const PERIOD_LABEL: Record<Period, string> = { day: "per day", week: "per week", month: "per month (30 days)" };

/** The Plan page's toolbar card (brief §6.4): plan select + name, orders per day, the period grain, Duplicate / New / Delete. */
export function PlanToolbar({
  plans,
  plan,
  period,
  onPeriod,
  onSelect,
  onChange,
  onDuplicate,
  onNew,
  onDelete,
  readOnly = false,
}: {
  plans: readonly Plan[];
  plan: Plan;
  period: Period;
  onPeriod: (p: Period) => void;
  onSelect: (id: string) => void;
  onChange: (fn: (p: Plan) => Plan) => void;
  onDuplicate: () => void;
  onNew: () => void;
  onDelete: () => void;
  /** A viewer: the plan select still works (locally), the rest is disabled and the buttons go. */
  readOnly?: boolean;
}) {
  const ids = { plan: useId(), name: useId(), orders: useId() };
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3">
      <Field label="Plan" htmlFor={ids.plan}>
        <Select value={plan.id} onValueChange={onSelect}>
          <SelectTrigger id={ids.plan} size="sm" className="h-8 min-w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span dir="auto">{p.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <fieldset disabled={readOnly} className="contents">
        <Field label="Name" htmlFor={ids.name}>
          <TextField id={ids.name} value={plan.name} onChange={(v) => onChange((p) => ({ ...p, name: v }))} className="w-44" />
        </Field>
        <Field label="Orders per day" hint={`≈ ${num2(plan.ordersPerDay * 7)} / week · ${num2(plan.ordersPerDay * 30)} / month`} htmlFor={ids.orders}>
          <NumberField id={ids.orders} value={plan.ordersPerDay} min={0} wrapperClassName="w-28" onChange={(v) => onChange((p) => ({ ...p, ordersPerDay: v }))} />
        </Field>
      </fieldset>
      <Field label="Show numbers">
        <SegmentedControl<Period>
          ariaLabel="Show numbers per"
          value={period}
          onChange={onPeriod}
          options={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
      </Field>
      {!readOnly && (
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={onDuplicate}>
          <CopyPlus aria-hidden /> Duplicate
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={onNew}>
          <Plus aria-hidden /> New plan
        </Button>
        <DisabledReason disabled={plans.length <= 1} reason="A version keeps at least one plan">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs text-neg hover:text-neg"
            disabled={plans.length <= 1}
            onClick={() => setConfirm(true)}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        </DisabledReason>
      </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={
          <>
            Delete &ldquo;<span dir="auto">{plan.name}</span>&rdquo;?
          </>
        }
        description="The plan's mix and volume go. The version's other plans stay as they are."
        confirmLabel="Delete plan"
        onConfirm={onDelete}
      />
    </div>
  );
}
