import { ComingSoon } from "@/components/trends/coming-soon";

export default function TrendsByTagPage() {
  return (
    <ComingSoon
      title="By tag"
      description="Roll up performance by the tags on each creative — the most actionable axis when planning the next batch of tests."
      bullets={[
        "Spend, blended CTR, CPA, and ROAS per tag, sortable.",
        "Creative count per tag and the top-performing creative inside each.",
        "Click a tag → jumps to a filtered Library view.",
        "Same period-over-period deltas as Over time, scoped per tag.",
      ]}
    />
  );
}
