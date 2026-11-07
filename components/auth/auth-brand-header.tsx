import type { ReactNode } from "react";
import { LogoMark } from "@/components/layout/logo-mark";
import { BrandWordmark } from "@/components/layout/brand-wordmark";

/**
 * The (auth) group's brand block — the Wizard mark and wordmark above the
 * card — shared by sign-in and OAuth consent (R-109): a person arriving from
 * an external MCP client needs to recognise whose app is asking, so the
 * permission screen wears the same brand as the sign-in it follows.
 */
export function AuthBrandHeader({ kicker }: { kicker?: ReactNode }) {
  return (
    <div className="text-center space-y-2">
      <LogoMark className="h-16 w-auto mx-auto" />
      <div>
        <BrandWordmark className="text-4xl" />
        {kicker && <div className="text-label text-ink-3 mt-2">{kicker}</div>}
      </div>
    </div>
  );
}
