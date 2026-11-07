"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { shallowParams } from "@/lib/shallow-url";
import type { platformEnum } from "@/lib/enums";

type Platform = (typeof platformEnum)[number];

/**
 * One platform's header mappings at a time (R-081): five platforms × ~18
 * fields stacked was several thousand pixels to edit one platform's headers.
 * Every panel is rendered on the server; this only picks which one shows, so
 * the pick is a SHALLOW `?platform=` param (D12: presentation only, history
 * API, no server render). An unknown or absent value shows the first.
 */
export function MappingPlatformSwitch({
  panels,
}: {
  panels: ReadonlyArray<{ platform: Platform; label: string; node: ReactNode }>;
}) {
  const params = useSearchParams();
  const wanted = params.get("platform");
  const active = panels.find((p) => p.platform === wanted)?.platform ?? panels[0]?.platform;
  if (!active) return null;
  return (
    <div className="space-y-3">
      <div className="max-w-full overflow-x-auto">
        <SegmentedControl<Platform>
          ariaLabel="Platform"
          value={active}
          onChange={(p) =>
            shallowParams((q) => {
              if (p === panels[0]?.platform) q.delete("platform");
              else q.set("platform", p);
            }, "replace")
          }
          options={panels.map((p) => ({ value: p.platform, label: p.label }))}
        />
      </div>
      {panels.map((p) => (
        <div key={p.platform} hidden={p.platform !== active}>
          {p.node}
        </div>
      ))}
    </div>
  );
}
