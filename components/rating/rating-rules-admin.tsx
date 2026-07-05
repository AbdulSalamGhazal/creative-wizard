"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  clearPlatformRatingRules,
  updatePlatformRatingRules,
  updateRatingRules,
} from "@/app/actions/rating";
import { RATING_META, type RatingConfig, type RatingRules } from "@/lib/rating";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Platform = (typeof ALL_PLATFORMS)[number];

function validate(ms: number, g: number, d: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return "Minimum spend must be 0 or more.";
  if (!Number.isFinite(g) || g <= 0) return "Good ROAS must be greater than 0.";
  if (!Number.isFinite(d) || d <= 0) return "Decent ROAS must be greater than 0.";
  if (g <= d) return "Good ROAS must be higher than Decent ROAS.";
  return null;
}

const summarize = (r: RatingRules) =>
  `Good ≥ ${r.goodRoas}× · Decent ≥ ${r.decentRoas}× · min ${usd(r.minSpend)}`;

/**
 * Admin editor for the Summary Rate column. A default config applies to the
 * blended total and any platform without an override; each platform can be
 * given its own thresholds.
 */
export function RatingRulesAdmin({ config }: { config: RatingConfig }) {
  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-sm font-medium text-ink">Rate rules</h2>
        <p className="text-xs text-ink-2 mt-1">
          Drives the <span className="text-ink">Rate</span> column on Summary.
          The default applies to the blended total and any platform without its
          own override below.
        </p>
      </div>

      <DefaultEditor rules={config.default} />

      <div className="border-t border-line pt-6">
        <h3 className="text-sm font-medium text-ink">Per-platform overrides</h3>
        <p className="text-xs text-ink-2 mt-1 mb-4">
          Turn on a platform to give it its own cutoffs. Off = uses the default.
        </p>
        <div className="space-y-2.5">
          {ALL_PLATFORMS.map((p) => (
            <PlatformOverrideEditor
              key={p}
              platform={p}
              override={config.byPlatform[p] ?? null}
              def={config.default}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Three threshold inputs, shared by the default + platform editors. */
function ThresholdInputs({
  idPrefix,
  minSpend,
  goodRoas,
  decentRoas,
  setMinSpend,
  setGoodRoas,
  setDecentRoas,
}: {
  idPrefix: string;
  minSpend: string;
  goodRoas: string;
  decentRoas: string;
  setMinSpend: (v: string) => void;
  setGoodRoas: (v: string) => void;
  setDecentRoas: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-minSpend`} className="text-[11px]">
          Min spend to rate
        </Label>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 text-xs">$</span>
          <Input id={`${idPrefix}-minSpend`} inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} className="h-9 pl-5 num" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-goodRoas`} className="text-[11px]">Good when ROAS ≥</Label>
        <div className="relative">
          <Input id={`${idPrefix}-goodRoas`} inputMode="decimal" value={goodRoas} onChange={(e) => setGoodRoas(e.target.value)} className="h-9 pr-6 num" />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 text-xs">×</span>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-decentRoas`} className="text-[11px]">Decent when ROAS ≥</Label>
        <div className="relative">
          <Input id={`${idPrefix}-decentRoas`} inputMode="decimal" value={decentRoas} onChange={(e) => setDecentRoas(e.target.value)} className="h-9 pr-6 num" />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 text-xs">×</span>
        </div>
      </div>
    </div>
  );
}

function DefaultEditor({ rules }: { rules: RatingRules }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [minSpend, setMinSpend] = useState(String(rules.minSpend));
  const [goodRoas, setGoodRoas] = useState(String(rules.goodRoas));
  const [decentRoas, setDecentRoas] = useState(String(rules.decentRoas));

  const nums = useMemo(
    () => ({ ms: Number(minSpend), g: Number(goodRoas), d: Number(decentRoas) }),
    [minSpend, goodRoas, decentRoas],
  );
  const error = validate(nums.ms, nums.g, nums.d);
  const dirty =
    String(rules.minSpend) !== minSpend.trim() ||
    String(rules.goodRoas) !== goodRoas.trim() ||
    String(rules.decentRoas) !== decentRoas.trim();

  const save = () => {
    if (error) return toast.error(error);
    startTransition(async () => {
      const res = await updateRatingRules({ minSpend: nums.ms, goodRoas: nums.g, decentRoas: nums.d });
      if (!res.ok) { toast.error(res.error ?? "Could not save"); return; }
      toast.success("Default rating rules saved");
      router.refresh();
    });
  };

  const tiers: Array<{ rating: keyof typeof RATING_META; when: string }> = [
    { rating: "good", when: `ROAS ≥ ${goodRoas || "—"}×` },
    { rating: "decent", when: `${decentRoas || "—"}× ≤ ROAS < ${goodRoas || "—"}×` },
    { rating: "bad", when: `ROAS < ${decentRoas || "—"}×` },
    { rating: "na", when: `Spend < ${Number.isFinite(nums.ms) ? usd(nums.ms) : "—"} (or no data)` },
  ];

  return (
    <div className="space-y-3">
      <div className="text-label text-ink-3">Default (blended + un-overridden platforms)</div>
      <ThresholdInputs
        idPrefix="default"
        minSpend={minSpend} goodRoas={goodRoas} decentRoas={decentRoas}
        setMinSpend={setMinSpend} setGoodRoas={setGoodRoas} setDecentRoas={setDecentRoas}
      />
      <div className="rounded-lg border border-line bg-surface p-3">
        <ul className="space-y-1.5">
          {tiers.map((t) => (
            <li key={t.rating} className="flex items-center gap-2.5 text-xs">
              <span className={"inline-flex items-center justify-center h-5 px-1.5 rounded text-[10px] border whitespace-nowrap w-14 " + RATING_META[t.rating].badgeClass}>
                {RATING_META[t.rating].label}
              </span>
              <span className="text-ink-2 num">{t.when}</span>
            </li>
          ))}
        </ul>
      </div>
      {error && <p className="text-xs text-neg">{error}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!!error || !dirty || isPending}>
          {isPending ? "Saving…" : "Save default"}
        </Button>
        {!dirty && !isPending && <span className="text-[11px] text-ink-3">No changes.</span>}
      </div>
    </div>
  );
}

function PlatformOverrideEditor({
  platform,
  override,
  def,
}: {
  platform: Platform;
  override: RatingRules | null;
  def: RatingRules;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [custom, setCustom] = useState(override !== null);
  const seed = override ?? def;
  const [minSpend, setMinSpend] = useState(String(seed.minSpend));
  const [goodRoas, setGoodRoas] = useState(String(seed.goodRoas));
  const [decentRoas, setDecentRoas] = useState(String(seed.decentRoas));

  const nums = { ms: Number(minSpend), g: Number(goodRoas), d: Number(decentRoas) };
  const error = validate(nums.ms, nums.g, nums.d);

  const save = () => {
    if (error) return toast.error(error);
    startTransition(async () => {
      const res = await updatePlatformRatingRules({ platform, minSpend: nums.ms, goodRoas: nums.g, decentRoas: nums.d });
      if (!res.ok) { toast.error(res.error ?? "Could not save"); return; }
      toast.success(`${PLATFORM_LABEL[platform]} override saved`);
      router.refresh();
    });
  };

  const toggle = () => {
    if (custom) {
      // Turning off — if it was persisted, clear it; otherwise just hide.
      if (override) {
        startTransition(async () => {
          const res = await clearPlatformRatingRules({ platform });
          if (!res.ok) { toast.error(res.error ?? "Could not reset"); return; }
          toast.success(`${PLATFORM_LABEL[platform]} reverted to default`);
          router.refresh();
        });
      } else {
        setCustom(false);
      }
    } else {
      // Turning on — seed inputs from the default.
      setMinSpend(String(def.minSpend));
      setGoodRoas(String(def.goodRoas));
      setDecentRoas(String(def.decentRoas));
      setCustom(true);
    }
  };

  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <PlatformDot platform={platform} />
          <span className="text-sm text-ink">{PLATFORM_LABEL[platform]}</span>
          <span className="text-[11px] text-ink-3 truncate">
            {custom ? "Custom" : `Default · ${summarize(def)}`}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={custom}
          disabled={isPending}
          onClick={toggle}
          className={cn(
            "inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
            custom ? "bg-brand/80 border-brand" : "bg-surface-2 border-line-2",
          )}
          title={custom ? "Disable override (use default)" : "Add a custom override"}
        >
          <span className={cn("h-4 w-4 rounded-full bg-white shadow-sm transition-transform", custom ? "translate-x-4" : "translate-x-0.5")} />
        </button>
      </div>

      {custom && (
        <div className="mt-3 space-y-2.5">
          <ThresholdInputs
            idPrefix={platform}
            minSpend={minSpend} goodRoas={goodRoas} decentRoas={decentRoas}
            setMinSpend={setMinSpend} setGoodRoas={setGoodRoas} setDecentRoas={setDecentRoas}
          />
          {error && <p className="text-[11px] text-neg">{error}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={!!error || isPending}>
              {isPending ? "Saving…" : override ? "Save override" : "Create override"}
            </Button>
            {override && (
              <Button size="sm" variant="ghost" onClick={toggle} disabled={isPending}>
                Reset to default
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
