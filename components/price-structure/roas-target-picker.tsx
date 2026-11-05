"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { METRICS } from "@/price-structure/engine/metrics";
import { eligibleRoasTargets, resolveRoasTarget } from "@/price-structure/engine/targets";
import { useVersion } from "./version-provider";

/**
 * "ROAS for A / B: {metric label}" (brief §5.6) — which CML target drives
 * every "ROAS for A / B" in the module. Shown only when two or more targets
 * are eligible; saved on the version, so a change here changes it everywhere.
 */
export function RoasTargetPicker() {
  const { open, updateData } = useVersion();
  if (!open) return null;
  const eligible = eligibleRoasTargets(open.data.targets);
  if (eligible.length < 2) return null;
  const current = resolveRoasTarget(open.data.targets, open.data.roasTargetId);
  return (
    <Select value={current?.id ?? ""} onValueChange={(id) => updateData("data.roasTargetId", (d) => ({ ...d, roasTargetId: id }))}>
      <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Which target drives ROAS for A / B">
        <span className="text-ink-3">ROAS for A / B:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {eligible.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {METRICS[t.metric].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
