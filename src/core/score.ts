import type { Finding, RiskScore, Severity } from "@/types";

const DEFAULT_WEIGHTS: Record<Severity, number> = {
  critical: 5,
  high: 3,
  moderate: 2,
  low: 1
};

export function computeRiskScore(findings: Finding[]): RiskScore {
  const total = findings.reduce((acc, finding) => acc + DEFAULT_WEIGHTS[finding.severity], 0);
  const normalized = Math.min(Math.round((total / 20) * 100), 100);
  const riskLevel = determineRiskLevel(normalized);
  return {
    overall: normalized,
    riskLevel,
    weights: DEFAULT_WEIGHTS
  };
}

function determineRiskLevel(score: number): RiskScore["riskLevel"] {
  if (score >= 85) return "Critical";
  if (score >= 60) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}
