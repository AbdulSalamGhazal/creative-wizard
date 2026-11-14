"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { moveBudgetMoney } from "@/app/actions/budget";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { PlatformDot } from "@/components/ui/platform-dot";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { monthLabel } from "@/lib/budget";
import { previewMove, type MoveSource, type PlanMove } from "@/lib/budget-move";
import type { RangeModel } from "@/lib/budget-range";
import { platformLabel } from "@/components/budget/budget-shared";

const RESERVE = "reserve";

/**
 * Today → Move money: shift planned dollars between platforms (or out of the
 * reserve) and see, before saving, what each remaining day then has to spend.
 * The preview is the board's own needed-per-day (`previewMove`); the save
 * posts only the move, and the server applies it to the stored plan through
 * the one plan writer — a revision is recorded like any other save.
 */
export function MoveMoneySheet({
  model,
  month,
  brand,
  fmt,
  disabledReason,
}: {
  /** The month's range model — the plan and each platform's pace. */
  model: RangeModel;
  month: string;
  /** The brand this page rendered under — the save is pinned to it. */
  brand: string;
  /** USD amounts in the display currency, whole. */
  fmt: (usd: number) => string;
  /** Why money can't be moved here (a day-by-day month), if it can't. */
  disabledReason?: string;
}) {
  const plan = model.monthPlan;
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planned = useMemo(() => {
    const totals = new Map<string, number>();
    for (const a of plan?.allocations ?? []) {
      totals.set(a.platform, (totals.get(a.platform) ?? 0) + a.plannedSpend);
    }
    return [...totals].sort((a, b) => b[1] - a[1]);
  }, [plan]);
  const reserve = plan?.reserveSpendUsd ?? 0;

  const amount = Number(amountText);
  const move: PlanMove | null =
    from && to && Number.isFinite(amount) && amount > 0
      ? {
          from: (from === RESERVE ? { kind: "reserve" } : { kind: "platform", platform: from }) as MoveSource,
          to,
          amount,
        }
      : null;
  const preview = useMemo(
    () => (plan && move ? previewMove(model, plan, move) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, plan, from, to, amount],
  );
  const available = from === RESERVE ? reserve : (planned.find(([p]) => p === from)?.[1] ?? 0);
  const tooMuch = move !== null && amount > available;

  const reset = () => {
    setFrom("");
    setTo("");
    setAmountText("");
    setNote("");
    setError(null);
  };
  const save = async () => {
    if (!move) return;
    setPending(true);
    setError(null);
    try {
      const res = await safeAction(() =>
        moveBudgetMoney({ month, brand, ...move, note: note.trim() === "" ? undefined : note.trim() }),
      );
      if (!res.ok) {
        // The form keeps what was typed; the reason is shown in it.
        setError(res.error ?? "Couldn't move the money.");
        toastActionFailure(res, "Couldn't move the money");
        return;
      }
      // ONE render: the action revalidated, so the new plan arrived with it.
      toast.success("Money moved");
      setOpen(false);
      reset();
    } finally {
      setPending(false);
    }
  };

  if (planned.length === 0) return null;
  const canPick = planned.length >= 2 || reserve > 0;
  const reason = disabledReason ?? (canPick ? undefined : "Needs two planned platforms, or a reserve");

  return (
    <>
      <DisabledReason disabled={!!reason} reason={reason ?? ""}>
        <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)} disabled={!!reason}>
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Move money
        </Button>
      </DisabledReason>
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!pending) setOpen(v);
        }}
      >
        <SheetContent side="right" className="flex w-[min(26rem,100vw)] flex-col gap-0 p-0">
          <SheetHeader className="border-b border-line px-4 py-3">
            <SheetTitle>Move money</SheetTitle>
            <SheetDescription>{monthLabel(month)} · the total stays the same</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <Field label="From" htmlFor="move-from">
              <Select value={from} onValueChange={(v) => { setFrom(v); if (v === to) setTo(""); }}>
                <SelectTrigger id="move-from" className="w-full">
                  <SelectValue placeholder="Where the money leaves" />
                </SelectTrigger>
                <SelectContent>
                  {reserve > 0 && (
                    <SelectItem value={RESERVE}>
                      Reserve · <span className="tabular-nums">{fmt(reserve)}</span>
                    </SelectItem>
                  )}
                  {planned.map(([p, total]) => (
                    <SelectItem key={p} value={p}>
                      <span className="inline-flex items-center gap-1.5">
                        <PlatformDot platform={p} />
                        {platformLabel(p)} · <span className="tabular-nums">{fmt(total)}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="To" htmlFor="move-to">
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger id="move-to" className="w-full">
                  <SelectValue placeholder="Where it goes" />
                </SelectTrigger>
                <SelectContent>
                  {planned
                    .filter(([p]) => p !== from)
                    .map(([p, total]) => (
                      <SelectItem key={p} value={p}>
                        <span className="inline-flex items-center gap-1.5">
                          <PlatformDot platform={p} />
                          {platformLabel(p)} · <span className="tabular-nums">{fmt(total)}</span>
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Amount (USD)"
              htmlFor="move-amount"
              error={tooMuch ? `Only ${fmt(available)} is there to move.` : undefined}
            >
              <Input
                id="move-amount"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="500"
                className="tabular-nums"
                aria-invalid={tooMuch}
              />
            </Field>

            {preview && (
              <section aria-label="What this changes" className="rounded-md border border-line">
                <ul className="divide-y divide-line">
                  {preview.map((line) => (
                    <li key={line.key} className="space-y-1 px-3 py-2.5 text-sm">
                      <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                        {line.key !== RESERVE && <PlatformDot platform={line.key} />}
                        {line.key === RESERVE ? "Reserve" : platformLabel(line.key)}
                      </span>
                      <Change label="Plan" before={fmt(line.planBefore)} after={fmt(line.planAfter)} />
                      {line.key !== RESERVE && (
                        <Change
                          label="Needs per day"
                          before={line.neededBefore === null ? "—" : fmt(line.neededBefore)}
                          after={line.neededAfter === null ? "—" : fmt(line.neededAfter)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Field label="Note" htmlFor="move-note" hint="Shown in the plan's revisions.">
              <Input
                id="move-note"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Snapchat is over pace"
                dir="auto"
              />
            </Field>
            <FormError>{error}</FormError>
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-line px-4 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={!preview || pending}>
              {pending ? "Moving…" : "Move money"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Change({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <span className="flex items-baseline justify-between gap-3 text-xs text-ink-2">
      <span>{label}</span>
      <span className="inline-flex items-baseline gap-1.5 tabular-nums">
        {before}
        <ArrowRight className="h-3 w-3 self-center" aria-label="becomes" />
        <span className="text-ink">{after}</span>
      </span>
    </span>
  );
}
