"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sar, usd } from "@/lib/format";
import { monthKey, nextMonthKey, prevMonthKey, spendInDisplayCurrency } from "@/lib/budget";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";

/**
 * Shared client-side plumbing for the four Budget pages: the month bar (with a
 * year dropdown), the per-user display-currency toggle, and the data-horizon
 * note. Keeping these here means the pages can't drift apart on month
 * navigation or currency semantics.
 */

export type BudgetCurrency = "USD" | "SAR";
const CURRENCY_KEY = "cw-budget-currency";

/** Display-currency preference (display-only → localStorage, like v1). */
export function useBudgetCurrency(): [BudgetCurrency, (c: BudgetCurrency) => void] {
  const [currency, setCurrency] = useState<BudgetCurrency>("USD");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CURRENCY_KEY);
      if (stored === "SAR" || stored === "USD") setCurrency(stored);
    } catch {
      /* keep USD */
    }
  }, []);
  const pick = (c: BudgetCurrency) => {
    setCurrency(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      /* ignore */
    }
  };
  return [currency, pick];
}

/** Format a USD spend figure in the chosen display currency via the rate. */
export function formatSpend(usdAmount: number, currency: BudgetCurrency, rate: number): string {
  return currency === "SAR"
    ? sar(spendInDisplayCurrency(usdAmount, "SAR", rate))
    : usd(usdAmount);
}

/** The USD / SAR segmented toggle. */
export function CurrencyToggle({
  currency,
  onChange,
}: {
  currency: BudgetCurrency;
  onChange: (c: BudgetCurrency) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {(["USD", "SAR"] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            currency === c ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The month bar every Budget page shares: ‹ › steppers, the month name, a year
 * dropdown, and a "Today" shortcut off the current month. Navigates by
 * replacing `?month=` on the CURRENT pathname, so each page keeps its own
 * route. `children` is the page's right-side control cluster.
 */
export function BudgetMonthBar({
  month,
  today,
  children,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();
  const go = (m: string) =>
    startNav(() => router.replace(`${pathname}?month=${m}`, { scroll: false }));

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthName = MONTH_NAMES[Number(monthStr) - 1] ?? month;
  const currentYear = Number(today.slice(0, 4));
  // A window wide enough for history and forward planning without a free-text
  // input: 3 years back, 1 forward (union'd with the shown year so an odd URL
  // never renders an empty dropdown).
  const years = Array.from(
    new Set([year, ...Array.from({ length: 5 }, (_, i) => currentYear - 3 + i)]),
  ).sort((a, b) => a - b);

  const isCurrentMonth = monthKey(today) === month;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => go(prevMonthKey(month))}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[6.5rem] text-center font-display text-lg">{monthName}</span>
        <Select value={String(year)} onValueChange={(y) => go(`${y}-${monthStr}`)}>
          <SelectTrigger
            className="h-7 w-[5.4rem] text-sm num"
            aria-label="Year"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => go(nextMonthKey(month))}
          aria-label="Next month"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {!isCurrentMonth && (
          <Button type="button" variant="ghost" size="xs" onClick={() => go(monthKey(today))}>
            Today
          </Button>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * The day (1..N) of `month` covered by data, given the account's data horizon
 * (latest performance-record date). 0 = nothing yet; full length for months
 * entirely behind the horizon.
 */
export function horizonDayInMonth(
  month: string,
  horizon: string | null,
  totalDays: number,
): number {
  if (!horizon) return 0;
  const h = horizon.slice(0, 7);
  if (h < month) return 0;
  if (h > month) return totalDays;
  return Math.min(totalDays, Number(horizon.slice(8, 10)));
}

/** The shared "data through …" note (Overview + Daily). */
export function HorizonNote({ horizon }: { horizon: string | null }) {
  if (!horizon) return null;
  const label = new Date(`${horizon}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <p className="text-[11px] text-ink-3">
      Ad data through {label} — later days aren&rsquo;t zero, just not uploaded yet.
    </p>
  );
}

/** Anchor id for a platform's group on the Plan page (Overview cards link here). */
export function platformAnchorId(platform: string): string {
  return `platform-${platform}`;
}
