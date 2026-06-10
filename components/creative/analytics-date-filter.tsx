"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { DateRangePicker } from "@/components/filters/date-range-picker";

/**
 * URL-bound date range for the Creative detail Analytics section. Writes
 * `from`/`to` search params (date-only) and lets the server component re-query.
 */
export function AnalyticsDateFilter({
  from,
  to,
  defaultFrom,
  defaultTo,
}: {
  from: string | null;
  to: string | null;
  /** Effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const onChange = (nextFrom: string | null, nextTo: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFrom) params.set("from", nextFrom);
    else params.delete("from");
    if (nextTo) params.set("to", nextTo);
    else params.delete("to");
    const qs = params.toString();
    startTransition(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  };

  return (
    <DateRangePicker
      from={from}
      to={to}
      onChange={onChange}
      remember
      fallback={
        defaultFrom && defaultTo
          ? { from: defaultFrom, to: defaultTo }
          : undefined
      }
    />
  );
}
