export type Severity = "critical" | "high" | "moderate" | "low";

export interface RuleDefinition {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  owasp: string[];
  fileGlobs: string[];
  contentRegex: string;
  evidenceHint: string;
  remediation: string;
  confidence: number;
}

export interface CompiledRule extends RuleDefinition {
  regex: RegExp;
  globMatchers: RegExp[];
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  severity: Severity;
  category: string;
  owasp: string[];
  file: string;
  line: number | null;
  evidence: string;
  remediation: string;
  confidence: number;
}

export interface Inventory {
  sdks: string[];
  models: string[];
  frameworks: string[];
  tools: string[];
}

export interface ScanStats {
  files: number;
  scanned: number;
  skipped: number;
  durationMs: number;
}

export interface RiskScore {
  overall: number;
  riskLevel: "Low" | "Medium" | "High" | "Critical";
  weights: Record<Severity, number>;
}

export interface FindingGroup {
  id: string;
  primaryFinding: Finding;
  relatedFindings: Finding[];
  file: string;
  severity: Severity;
  category: string;
  riskBoost: number;
  // Phase 2: composite scoring for multi-signal confidence
  compositeScore?: number; // 0..1 combined confidence from multiple signals
  contributingSignals?: Array<{
    ruleId: string;
    weight: number;
    confidence: number;
    role: "usage" | "hint" | "metadata";
  }>;
}

// Phase 3: Reachability graph types (re-exported from reachability.ts)
export type { ReachabilityGraph, GraphNode, GraphEdge, RiskyPath } from "@/core/reachability";

export interface Report {
  repo: string;
  branch: string;
  scannedAt: string;
  stats: ScanStats;
  inventory: Inventory;
  findings: Finding[];
  groups?: FindingGroup[]; // Grouped findings for better organization
  score: RiskScore;
  // Phase 3: Reachability graph (optional, built during scan)
  graph?: ReachabilityGraph;
  riskyPaths?: RiskyPath[];
}

export interface ScanContext {
  owner: string;
  repo: string;
  branch: string;
  sha?: string;
}

export type ProgressState =
  | { step: "idle"; message: string }
  | { step: "parsing"; message: string }
  | { step: "resolving"; message: string }
  | { step: "downloading"; message: string; progress?: number }
  | { step: "unzipping"; message: string }
  | { step: "scanning"; message: string; currentFile?: string; scanned?: number; total?: number }
  | { step: "report"; message: string }
  | { step: "error"; message: string };

export interface RulePackIndex {
  rules: RuleDefinition[];
  owasp: Record<string, { title: string; description: string }>;
}
