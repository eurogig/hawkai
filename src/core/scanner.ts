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
import { getScoringConfig } from "./scoring";

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
  "AI-FP-GPT-MODEL-EXPANDED": { models: ["gpt-4o", "gpt-4-turbo", "gpt-4.1", "gpt-4o-mini", "gpt-4-32k", "gpt-3.5-turbo"] },
  "AI-FP-OPENAI-CLIENT": { sdks: ["openai"] },
  "AI-FP-CHAT-COMPLETION": { sdks: ["openai"] },
  "AI-FP-OPENAI-ENDPOINT": { sdks: ["openai"] },
  "AI-FP-OPENAI-FUNCTION-CALLING": { sdks: ["openai"], tools: ["function calling"] },
  "AI-FP-GOOGLE-GEMINI-IMPORT": { sdks: ["google-gemini"], models: ["gemini"] },
  "AI-FP-GEMINI-MODEL": { models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro", "gemini-ultra"] },
  "AI-FP-GOOGLE-ENDPOINT": { sdks: ["google-gemini"] },
  "AI-FP-AZURE-OPENAI-IMPORT": { sdks: ["azure-openai"], models: ["gpt-4", "gpt-4o"] },
  "AI-FP-AWS-BEDROCK-IMPORT": { sdks: ["aws-bedrock"], models: ["claude", "llama", "mistral", "titan"] },
  "AI-FP-AWS-BEDROCK-ENDPOINT": { sdks: ["aws-bedrock"] },
  "AI-FP-MISTRAL-IMPORT": { sdks: ["mistral"], models: ["mistral"] },
  "AI-FP-MISTRAL-MODEL": { models: ["mistral-large-latest", "mistral-medium", "mistral-small", "mixtral-8x7b", "mixtral-8x22b"] },
  "AI-FP-COHERE-IMPORT": { sdks: ["cohere"], models: ["command", "embed"] },
  "AI-FP-GROQ-IMPORT": { sdks: ["groq"], models: ["llama", "mixtral"] },
  "AI-FP-LM-STUDIO-IMPORT": { sdks: ["lm-studio"], tools: ["local models"] },
  "AI-FP-OLLAMA-IMPORT": { sdks: ["ollama"], tools: ["local models"] },
  "AI-FP-VLLM-IMPORT": { sdks: ["vllm"], tools: ["local models"] },
  "AI-FP-LLAMA-CPP-IMPORT": { sdks: ["llama.cpp"], tools: ["local models"] },
  "AI-FP-LANGGRAPH-IMPORT": { frameworks: ["langgraph"] },
  "AI-FP-AUTOGEN-IMPORT": { frameworks: ["autogen"] },
  "AI-FP-CREWAI-IMPORT": { frameworks: ["crewai"] },
  "AI-FP-SEMANTIC-KERNEL-IMPORT": { frameworks: ["semantic-kernel"] },
  "AI-FP-LLAMAINDEX-IMPORT": { frameworks: ["llamaindex"] },
  "AI-FP-DSPY-IMPORT": { frameworks: ["dspy"] },
  "AI-FP-HAYSTACK-IMPORT": { frameworks: ["haystack"] },
  "AI-FP-LCEL-PATTERN": { frameworks: ["langchain", "lcel"] },
  "AI-FP-CLAUDE-MODEL": { models: ["claude-3.5-sonnet", "claude-3-opus", "claude-3-sonnet", "claude-3-haiku", "claude-2"] },
  "AI-FP-ANTHROPIC-ENDPOINT": { sdks: ["anthropic"] },
  "AI-MCP-IMPORT": { frameworks: ["MCP"], tools: ["Model Context Protocol"] },
  "AI-MCP-CLIENT": { frameworks: ["MCP"], tools: ["MCP client"] },
  "AI-MCP-TOOLS": { frameworks: ["MCP"], tools: ["MCP tools"] },
  "AI-MCP-PROTOCOL": { frameworks: ["MCP"] },
  "AI-MCP-CONFIG": { frameworks: ["MCP"] },
  "AI-MCP-ENV": { frameworks: ["MCP"] },
  "AG-ROUTER-ZEROSHOT": { tools: ["zero-shot tool router"] },
  "AG-TOOL-SELECTION-CLASSIFIER": { tools: ["classifier-based tool selection"] },
  "AG-LOOP-AUTOEXEC": { tools: ["autonomous agent loop"] },
  "AG-LOOP-WITH-AGENT": { tools: ["autonomous agent loop"] },
  "AG-ASYNC-AGENT-LOOP": { tools: ["autonomous agent loop"] },
  "AG-PLAN-EXEC": { tools: ["auto plan execution"] },
  "AG-LANGGRAPH-STATEGRAPH": { frameworks: ["langgraph"] },
  "AG-LANGGRAPH-NODES": { frameworks: ["langgraph"] },
  "AG-LANGGRAPH-EDGES": { frameworks: ["langgraph"] },
  "AG-LANGGRAPH-CONDITIONAL-EDGES": { frameworks: ["langgraph"] },
  "AG-LANGGRAPH-CREATE-AGENT": { frameworks: ["langgraph"], tools: ["react agent"] },
  "AG-LANGGRAPH-COMPILE": { frameworks: ["langgraph"] },
  "AG-LANGGRAPH-INVOKE": { frameworks: ["langgraph"] },
  "AG-LANGGRAPH-STREAM": { frameworks: ["langgraph"] },
  "AG-LANGCHAIN-INVOKE": { frameworks: ["langchain"] },
  "AG-TOOL-DECORATOR": { tools: ["agent tools"] },
  "AG-TOOL-CLASS": { tools: ["agent tools"] },
  "AG-TOOL-LIST": { tools: ["agent tools"] },
  "AG-STREAMLIT-INPUT": { tools: ["streamlit input"] },
  "AG-FUNCTION-TOOL-TYPE": { tools: ["function calling"] },
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
  const MAX_FILE_FINDINGS = getScoringConfig().caps.perFileFindings; // performance cap to avoid pathological files

  for (const rule of rules) {
    if (!ruleAppliesToPath(rule, path)) continue;

    rule.regex.lastIndex = 0;
    let match = rule.regex.exec(content);
    while (match) {
      const line = getLineNumber(content, match.index);
      const evidence = sanitizeEvidence(match[0] ?? "", rule);
      // Heuristic: reduce confidence for matches that appear in comment-only lines
      let effConfidence = rule.confidence;
      if (line != null) {
        const lineStart = content.lastIndexOf("\n", Math.max(0, match.index - 1)) + 1;
        const lineEndIdx = content.indexOf("\n", match.index);
        const lineEnd = lineEndIdx === -1 ? content.length : lineEndIdx;
        const lineText = content.slice(lineStart, lineEnd);
        const trimmed = lineText.trim();
        const idxInLine = match.index - lineStart;
        const commentPosSlash = lineText.indexOf("//");
        const commentPosHash = lineText.indexOf("#");
        const inSlashComment = commentPosSlash !== -1 && commentPosSlash <= idxInLine;
        const inHashComment = commentPosHash !== -1 && commentPosHash <= idxInLine;
        const startsWithComment = trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
        if (startsWithComment || inSlashComment || inHashComment) {
          effConfidence = Math.max(0, effConfidence * 0.6);
        }
      }
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
        confidence: effConfidence
      });
      if (findings.length >= MAX_FILE_FINDINGS) {
        return findings;
      }
      match = rule.regex.exec(content);
    }
    if (findings.length >= MAX_FILE_FINDINGS) {
      break;
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
