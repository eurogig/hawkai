import type { RiskScore } from "@/types";

interface RiskScoreProps {
  score: RiskScore;
}

const COLOR_MAP: Record<RiskScore["riskLevel"], string> = {
  Low: "border-severity-low text-severity-low bg-grey-charcoal",
  Medium: "border-severity-moderate text-severity-moderate bg-grey-charcoal",
  High: "border-severity-high text-severity-high bg-grey-charcoal",
  Critical: "border-severity-critical text-severity-critical bg-grey-charcoal shadow-terminal-glow"
};

function RiskScoreBadge({ score }: RiskScoreProps) {
  return (
    <div className={`border-2 px-6 py-4 text-center font-mono ${COLOR_MAP[score.riskLevel]}`}>
      <p className="text-xs uppercase tracking-wider font-bold"><span className="text-steampunk-brass">[</span>OVERALL RISK<span className="text-steampunk-brass">]</span></p>
      <p className="mt-1 text-4xl font-bold">{score.overall}</p>
      <p className="text-sm font-bold uppercase">{score.riskLevel}</p>
    </div>
  );
}

export default RiskScoreBadge;
