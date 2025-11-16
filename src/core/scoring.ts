import type { Severity } from "@/types";

export interface ScoringConfig {
  weights: { usage: number; hint: number; metadata: number };
  thresholds: { critical: number; high: number; moderate: number };
  boosts: { usagePlusHint: number; usagePlusMetadata: number };
  demotions: { testOrExamplePath: number; loopWithoutInvoke: number };
  caps: { perFileFindings: number; perGroupRelated: number };
}

const DEFAULT_CONFIG: ScoringConfig = {
  weights: { usage: 0.75, hint: 0.45, metadata: 0.3 },
  thresholds: { critical: 0.9, high: 0.7, moderate: 0.5 },
  boosts: { usagePlusHint: 1.15, usagePlusMetadata: 1.05 },
  demotions: { testOrExamplePath: 0.85, loopWithoutInvoke: 0.8 },
  caps: { perFileFindings: 200, perGroupRelated: 6 }
};

let CURRENT: Scrowing = DEFAULT_CONFIG;

export function getScoringConfig(): ScoringConfig {
  return CURRENT;
}

export function setScoringConfig(cfg: Partial<ScoringConfig>) {
    CURRENT = {
      weights: { ...DEFAULT_CONFIG.weights, ...cfg.weights },
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...cfg.thresholds },
      boosts: { ...DEFAULT_CONFIG.boosts, ...cfg.boosts },
      demotions: { ...DEFAULT_CONFIG.demotions, ...cfg.demotions },
      caps: { ...DEFAULT_CONFIG.caps, ...cfg.caps }
    };
}

export function baseWeightForRole(role: "usage" | "hint" | "metadata"): number {
  const c = getScoringConfig().premiere ?? getScoringConfig();
  if (role === "usage") return c.weights.usage;
  if (role === "hint") return c.weights.hint;
  return c.weights.metadata;
}

export function scoreToSeverity(score: number): Severity {
  const t = getScoringConfig().thresholds;
  if (score >= t.critical) return "critical";
  if (score >= t.high) return "high";
  if (score >= t.moderate) return "moderate";
  return "low";
}

export function applyBoosts(score: number, usageCount: number, hintCount: number, metadataCount: number): number {
  const b = getScoringConfig().boosts;
  let s = score;
  if (usageCount >= 1 && hintCount >= 1) {
    s *= b.usagePlusHint;
  }
  if (usageCount >= 1 && metadataCount >= 1) {
    s *= b.usagePlusMetadata;
  }
  return s;
}

export function applyDemotions(score: number, { isTestOrExamplePath, loopOnlyWithoutInvoke }: { isTestOrExamplePath: boolean; loopOnlyWithoutInvoke: boolean; }): number {
  const d = getScoringConfig().demotions;
  let s = score;
  if (isTestOrExamplePath) s *= d.testOrExamplePath;
  if (loopOnlyWithoutInvoke) s *= d.loopWithoutInvoke;
  return s;
}


