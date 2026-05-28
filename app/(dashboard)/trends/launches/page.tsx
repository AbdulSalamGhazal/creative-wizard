import { ComingSoon } from "@/components/trends/coming-soon";

export default function TrendsLaunchesPage() {
  return (
    <ComingSoon
      title="Launches"
      description="Cohort view normalised to launch date so creatives shipped in different months are directly comparable."
      bullets={[
        "First-7-day and first-30-day spend, CTR, and ROAS per launched creative.",
        "Launch cohort by month — which months produced the strongest first-30-day blended ROAS?",
        "Per-creative launch report card on the detail page.",
        "Portfolio-level 'launches this quarter' rollup.",
      ]}
    />
  );
}
