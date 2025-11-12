import { compileRules, ruleAppliesToPath } from "./rules";
import { decodeUtf8, isLikelyBinary, unzipArchive } from "./unzip";
import type {
  CompiledRule,
  Finding,
  FindingGroup,
  Inventory,
  Report,
  RuleDefinition,
  ScanContext,
  ScanStats
} from "@/types";
import { computeRiskScore } from "./score";
import { repoSlug } from "./url";
import { groupFindings } from "./grouping";

export interface ScanOptions {
  onProgress?: (update: { currentFile: string; scanned: number; total: number }) => void;
  maxFiles?: number;
  maxSizeBytes?: number;
}

export interface ScanResult {
  findings: Finding[];
  inventory: Inventory;
  stats: ScanStats;
}

const INVENTORY_RULE_MAP: Record<string, Partial<Inventory>> = {
  "AI-FP-OPENAI-IMPORT": { sdks: ["openai"], models: ["gpt-4", "gpt-4o"] },
  "AI-FP-ANTHROPIC-IMPORT": { sdks: ["anthropic"], models: ["claude"] },
  "AI-FP-LANGCHAIN-IMPORT": { frameworks: ["langchain"] },
  "AI-FP-GPT-MODEL": { models: ["gpt-4", "gpt-3.5", "gpt-4o", "gpt-4-turbo"] },
  "AI-FP-OPENAI-CLIENT": { sdks: ["openai"] },
  "AI-FP-CHAT-COMPLETION": { sdks: ["openai"] },
  "AI-MCP-IMPORT": { frameworks: ["MCP"], tools: ["Model Context Protocol"] },
  "AI-MCP-CLIENT": { frameworks: ["MCP"], tools: ["MCP client"] },
  "AI-MCP-TOOLS": { frameworks: ["MCP"], tools: ["MCP tools"] },
  "AI-MCP-PROTOCOL": { frameworks: ["MCP"] },
  "AI-MCP-CONFIG": { frameworks: ["MCP"] },
  "AI-MCP-ENV": { frameworks: ["MCP"] },
  "AG-ROUTER-ZEROSHOT": { tools: ["zero-shot tool router"] },
  "AG-TOOL-SELECTION-CLASSIFIER": { tools: ["classifier-based tool selection"] },
  "AG-LOOP-AUTOEXEC": { tools: ["autonomous agent loop"] },
  "AG-PLAN-EXEC": { tools: ["auto plan execution"] },
  "AG-A2A-FRAMEWORK": { frameworks: ["multi-agent"], tools: ["A2A orchestration"] },
  "AG-A2A-EXECUTOR": { frameworks: ["multi-agent"], tools: ["agent executor"] },
  "AG-A2A-MESSAGING": { frameworks: ["multi-agent"], tools: ["inter-agent messaging"] },
  "AG-A2A-ORCHESTRATION": { frameworks: ["multi-agent"] },
  "RAG-VECTOR-DB": { frameworks: ["RAG"], tools: ["vector database"] },
  "RAG-EMBEDDINGS": { frameworks: ["RAG"], tools: ["embeddings"] },
  "RAG-TEXT-SPLITTER": { frameworks: ["RAG"], tools: ["text chunking"] },
  "RAG-RETRIEVAL": { frameworks: ["RAG"], tools: ["vector search"] },
  "RAG-CHAIN": { frameworks: ["RAG"], tools: ["RAG chain"] },
  "RAG-LANGCHAIN-VECTORSTORE": { frameworks: ["RAG", "langchain"], tools: ["vector store"] },
  "RAG-CONTEXT-INJECTION": { frameworks: ["RAG"], tools: ["context injection"] }
};

export function buildInventory(): Inventory {
  return { sdks: [], models: [], frameworks: [], tools: [] };
}

export function mergeInventory(base: Inventory, addition: Partial<Inventory>) {
  if (addition.sdks) addUnique(base.sdks, addition.sdks);
  if (addition.models) addUnique(base.models, addition.models);
  if (addition.frameworks) addUnique(base.frameworks, addition.frameworks);
  if (addition.tools) addUnique(base.tools, addition.tools);
}

function addUnique(target: string[], items: string[]) {
  for (const item of items) {
    if (!target.includes(item)) {
      target.push(item);
    }
  }
}

export function compileRuleDefinitions(defs: RuleDefinition[]): CompiledRule[] {
  return compileRules(defs);
}

export function applyRulesToFile(path: string, content: string, rules: CompiledRule[]): Finding[] {
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (!ruleAppliesToPath(rule, path)) continue;

    rule.regex.lastIndex = 0;
    let match = rule.regex.exec(content);
    while (match) {
      const line = getLineNumber(content, match.index);
      const evidence = sanitizeEvidence(match[0] ?? "", rule);
      findings.push({
        id: `${rule.id}-${path}-${line ?? 0}-${match.index}`,
        ruleId: rule.id,
        title: rule.title,
        severity: rule.severity,
        category: rule.category,
        owasp: rule.owasp,
        file: path,
        line,
        evidence,
        remediation: rule.remediation,
        confidence: rule.confidence
      });
      match = rule.regex.exec(content);
    }
  }

  return findings;
}

function sanitizeEvidence(value: string, rule: CompiledRule): string {
  let sanitized = rule.category === "Secrets" ? maskSecrets(value) : value;
  if (sanitized.length > 160) {
    return `${sanitized.slice(0, 80)}…${sanitized.slice(-20)}`;
  }
  return sanitized;
}

function maskSecrets(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 10) {
    return "****";
  }
  const visible = trimmed.slice(0, 6);
  const masked = "*".repeat(Math.max(trimmed.length - 10, 4));
  const suffix = trimmed.slice(-4);
  return `${visible}${masked}${suffix}`;
}

function getLineNumber(content: string, index: number): number | null {
  if (index < 0) return null;
  const sub = content.slice(0, index);
  return sub.split(/\r?\n/).length;
}

export function createReport(context: ScanContext, result: ScanResult): Report {
  const slug = repoSlug(context);
  
  // Group related findings (imports + usage, etc.)
  const groups = groupFindings(result.findings);
  
  // Compute risk score using grouped findings (groups have boosted severity)
  const score = computeRiskScoreFromGroups(groups);

  return {
    repo: slug,
    branch: context.branch,
    scannedAt: new Date().toISOString(),
    stats: result.stats,
    inventory: result.inventory,
    findings: result.findings, // Keep original for backward compatibility
    groups, // Add grouped findings
    score
  };
}

function computeRiskScoreFromGroups(groups: FindingGroup[]): ReturnType<typeof computeRiskScore> {
  // Use the primary finding from each group (which may have boosted severity)
  const findings = groups.map(g => g.primaryFinding);
  return computeRiskScore(findings);
}

export function scanArchive(
  context: ScanContext,
  buffer: Uint8Array,
  rules: CompiledRule[],
  options: ScanOptions = {}
): ScanResult {
  const entries = unzipArchive(buffer, {
    maxFiles: options.maxFiles,
    maxSizeBytes: options.maxSizeBytes
  });

  const findings: Finding[] = [];
  const inventory = buildInventory();
  let processed = 0;

  entries.forEach((entry, index) => {
    const { path, data } = entry;
    options.onProgress?.({ currentFile: path, scanned: index + 1, total: entries.length });

    if (isLikelyBinary(data)) {
      return;
    }

    const text = decodeUtf8(data);
    const fileFindings = applyRulesToFile(path, text, rules);
    if (fileFindings.length > 0) {
      findings.push(...fileFindings);
      for (const finding of fileFindings) {
        const inventoryPatch = INVENTORY_RULE_MAP[finding.ruleId];
        if (inventoryPatch) {
          mergeInventory(inventory, inventoryPatch);
        }
      }
    }
    processed += 1;
  });

  const stats: ScanStats = {
    files: entries.length,
    scanned: processed,
    skipped: entries.length - processed,
    durationMs: 0
  };

  return { findings, inventory, stats };
}
