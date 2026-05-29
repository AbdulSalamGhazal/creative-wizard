"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateRatingRules } from "@/app/actions/rating";
import { RATING_META, type RatingRules } from "@/lib/rating";
import { usd } from "@/lib/format";

interface Props {
  rules: RatingRules;
}

/**
 * Admin editor for the Summary Rate column. Three numbers — a spend gate and
 * two ROAS cutoffs — define four tiers. Shown live as a legend so the effect
 * of a change is obvious before saving.
 */
export function RatingRulesAdmin({ rules }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [minSpend, setMinSpend] = useState(String(rules.minSpend));
  const [goodRoas, setGoodRoas] = useState(String(rules.goodRoas));
  const [decentRoas, setDecentRoas] = useState(String(rules.decentRoas));

  const parsed = useMemo(() => {
    const ms = Number(minSpend);
    const g = Number(goodRoas);
    const d = Number(decentRoas);
    return { ms, g, d };
  }, [minSpend, goodRoas, decentRoas]);

  const error = useMemo(() => {
    const { ms, g, d } = parsed;
    if (!Number.isFinite(ms) || ms < 0) return "Minimum spend must be 0 or more.";
    if (!Number.isFinite(g) || g <= 0) return "Good ROAS must be greater than 0.";
    if (!Number.isFinite(d) || d <= 0) return "Decent ROAS must be greater than 0.";
    if (g <= d) return "Good ROAS must be higher than Decent ROAS.";
    return null;
  }, [parsed]);

  const dirty =
    String(rules.minSpend) !== minSpend.trim() ||
    String(rules.goodRoas) !== goodRoas.trim() ||
    String(rules.decentRoas) !== decentRoas.trim();

  const save = () => {
    if (error) {
      toast.error(error);
      return;
    }
    startTransition(async () => {
      const res = await updateRatingRules({
        minSpend: parsed.ms,
        goodRoas: parsed.g,
        decentRoas: parsed.d,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save rating rules");
        return;
      }
      toast.success("Rating rules saved");
      router.refresh();
    });
  };

  const tiers: Array<{ rating: keyof typeof RATING_META; when: string }> = [
    { rating: "good", when: `ROAS ≥ ${parsed.g || "—"}×` },
    {
      rating: "decent",
      when: `${parsed.d || "—"}× ≤ ROAS < ${parsed.g || "—"}×`,
    },
    { rating: "bad", when: `ROAS < ${parsed.d || "—"}×` },
    {
      rating: "na",
      when: `Spend < ${Number.isFinite(parsed.ms) ? usd(parsed.ms) : "—"} (or no data)`,
    },
  ];

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-sm font-medium text-ink">Rate rules</h2>
        <p className="text-[12px] text-ink-2 mt-1">
          Drives the <span className="text-ink">Rate</span> column on the
          Summary page. A creative is rated from its ROAS — per platform and on
          the blended total — but only once it has spent enough to judge.
          Applied globally (the same cutoffs for every platform).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="minSpend" className="text-[12px]">
            Minimum spend to rate
          </Label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 text-xs">
              $
            </span>
            <Input
              id="minSpend"
              inputMode="decimal"
              value={minSpend}
              onChange={(e) => setMinSpend(e.target.value)}
              className="h-9 pl-5 num"
            />
          </div>
          <p className="text-[10px] text-ink-3">Below this → N/A.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="goodRoas" className="text-[12px]">
            Good when ROAS ≥
          </Label>
          <div className="relative">
            <Input
              id="goodRoas"
              inputMode="decimal"
              value={goodRoas}
              onChange={(e) => setGoodRoas(e.target.value)}
              className="h-9 pr-6 num"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 text-xs">
              ×
            </span>
          </div>
          <p className="text-[10px] text-ink-3">Top tier.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="decentRoas" className="text-[12px]">
            Decent when ROAS ≥
          </Label>
          <div className="relative">
            <Input
              id="decentRoas"
              inputMode="decimal"
              value={decentRoas}
              onChange={(e) => setDecentRoas(e.target.value)}
              className="h-9 pr-6 num"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 text-xs">
              ×
            </span>
          </div>
          <p className="text-[10px] text-ink-3">Below this → Bad.</p>
        </div>
      </div>

      {/* Live preview of the tiers */}
      <div className="rounded-lg border border-line bg-surface p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Preview
        </div>
        <ul className="space-y-1.5">
          {tiers.map((t) => {
            const meta = RATING_META[t.rating];
            return (
              <li key={t.rating} className="flex items-center gap-2.5 text-[12px]">
                <span
                  className={
                    "inline-flex items-center justify-center h-5 px-1.5 rounded text-[10px] border whitespace-nowrap w-14 " +
                    meta.badgeClass
                  }
                >
                  {meta.label}
                </span>
                <span className="text-ink-2 num">{t.when}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {error && <p className="text-[12px] text-neg">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!!error || !dirty || isPending}>
          {isPending ? "Saving…" : "Save rules"}
        </Button>
        {!dirty && !isPending && (
          <span className="text-[11px] text-ink-3">No changes.</span>
        )}
      </div>
    </div>
  );
}
