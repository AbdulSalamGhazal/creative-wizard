import { ComingSoon } from "@/components/trends/coming-soon";

export default function TrendsVideoPage() {
  return (
    <ComingSoon
      title="Video diagnostics"
      description="Hook rate (3-second views per impression) and hold rate (15-second views per 3-second view) — the two signals that decide whether a video lives or dies."
      bullets={[
        "Per-video hook/hold rates with portfolio medians for context.",
        "Filter to video creatives only across every other Trends view.",
        "Diagnostic table: spend, hook rate, hold rate, completion-to-CTR ratio.",
        "Flags for hooks that are dropping week-over-week.",
      ]}
    />
  );
}
