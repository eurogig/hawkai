import type { Severity } from "@/types";

export interface ScoringConfig {
  weights: { usage: number; hint: number; metadata: number };
  thresholds: { critical: number; high: number; moderate: number; minGroup: number };
  boosts: { usagePlusHint: number; usagePlusMetadata: number };
  demotions: { testOrExamplePath: number; loopWithoutInvoke: number; mockLikePath: number };
  caps: { perFileFindings: number; perGroupRelated: number };
}

const DEFAULT_CONFIG: ScoringConfig = {
  weights: { usage: 0.75, hint: 0.45, metadata: 0.3 },
  thresholds: { critical: 0.9, high: 0.7, moderate: 0.5, minGroup: 0.35 },
  boosts: { usagePlusHint: 1.15, usagePlusMetadata: 1.05 },
  demotions: { testOrExamplePath: 0.85, loopWithoutInvoke: 0.8, mockLikePath: 0.9 },
  caps: { perFileFindings: 200, perGroupRelated: 6 }
};

let CURRENT: ScoringConfig = DEFAULTCONFIG_FIX();

function DEFAULTCONFIG_FIX(): ScoringConfig {
  // helper to allow tree-shaking friendly init
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export function getScoringConfig(): ScoringConfig {
  return CURRENT;
}

export function setScoringConfig(cfg: Partial<ScoringConfig>) {
  CURRENT = {
    weights: { ...DEFAULT_CONFIG.weights, ...(cfg.weights ?? {}) },
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(cfg.thresholds ?? {}) },
    boosts: { ...DEFAULT_CONFIG.boosts, ...(cfg.boosts ?? {}) },
    demotions: { ...DEFAULT_CONFIG.demotions, ...(cfg.demotions ?? {}) },
    caps: { ...DEFAULT_CONFIG.caps, ...(cfg.caps ?? {}) }
  };
}

export function baseWeightForRole(role: "usage" | "hint" | "metadata"): number {
  const c = getScoringConfig();
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

export function applyDemotions(
  score: number,
  {
    isTestOrExamplePath,
    loopOnlyWithoutInvoke,
    isMockLikePath
  }: { isTestOrExamplePath: boolean; loopOnlyWithoutInvoke: boolean; isMockLikePath: boolean }
): number {
  const d = getScoringConfig().demotions;
  let s = score;
  if (isTestOrExamplePath) s *= d.testOrExamplePath;
  if (loopOnlyWithoutInvoke) s *= d.loopWithoutInvoke;
  if (isMockLikePath) s *= d.mockLikePath;
  return s;
}


