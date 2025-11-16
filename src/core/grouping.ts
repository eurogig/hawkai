import type { Finding, FindingGroup, Severity } from "@/types";
import { applyDemotions, applyBoosts, baseWeightForRole, scoreToSeverity, getScoringConfig } from "@/core/scoring";

/**
 * Rule relationships: which rules are "hints" (imports, config) vs "usage" (actual calls)
 * Usage rules should be the parent, hint rules should be children
 */
const RULE_RELATIONSHIPS: Record<string, {
  type: "hint" | "usage" | "metadata";
  parentRules?: string[]; // If this is a hint, which usage rules it relates to
  childRules?: string[]; // If this is usage, which hint rules relate to it
}> = {
  // OpenAI patterns
  "AI-FP-OPENAI-IMPORT": { type: "hint", parentRules: ["AI-FP-OPENAI-CLIENT", "AI-FP-CHAT-COMPLETION", "AI-FP-OPENAI-ENDPOINT", "AI-FP-OPENAI-FUNCTION-CALLING"] },
  "AI-FP-OPENAI-CLIENT": { type: "usage", childRules: ["AI-FP-OPENAI-IMPORT"] },
  "AI-FP-CHAT-COMPLETION": { type: "usage", childRules: ["AI-FP-OPENAI-IMPORT", "AI-FP-OPENAI-CLIENT", "AI-FP-GPT-MODEL", "AI-FP-GPT-MODEL-EXPANDED"] },
  "AI-FP-GPT-MODEL": { type: "hint", parentRules: ["AI-FP-CHAT-COMPLETION"] },
  "AI-FP-GPT-MODEL-EXPANDED": { type: "hint", parentRules: ["AI-FP-CHAT-COMPLETION"] },
  "AI-FP-OPENAI-ENDPOINT": { type: "usage", childRules: ["AI-FP-OPENAI-IMPORT"] },
  "AI-FP-OPENAI-FUNCTION-CALLING": { type: "usage", childRules: ["AI-FP-OPENAI-IMPORT", "AI-FP-OPENAI-CLIENT"] },
  
  // Anthropic patterns
  "AI-FP-ANTHROPIC-IMPORT": { type: "hint", parentRules: ["AI-FP-ANTHROPIC-ENDPOINT"] },
  "AI-FP-ANTHROPIC-ENDPOINT": { type: "usage", childRules: ["AI-FP-ANTHROPIC-IMPORT", "AI-FP-CLAUDE-MODEL"] },
  "AI-FP-CLAUDE-MODEL": { type: "hint", parentRules: ["AI-FP-ANTHROPIC-ENDPOINT"] },
  
  // Google Gemini patterns
  "AI-FP-GOOGLE-GEMINI-IMPORT": { type: "hint", parentRules: ["AI-FP-GOOGLE-ENDPOINT"] },
  "AI-FP-GEMINI-MODEL": { type: "hint", parentRules: ["AI-FP-GOOGLE-ENDPOINT"] },
  "AI-FP-GOOGLE-ENDPOINT": { type: "usage", childRules: ["AI-FP-GOOGLE-GEMINI-IMPORT", "AI-FP-GEMINI-MODEL"] },
  
  // Azure OpenAI patterns
  "AI-FP-AZURE-OPENAI-IMPORT": { type: "hint", parentRules: [] },
  
  // AWS Bedrock patterns
  "AI-FP-AWS-BEDROCK-IMPORT": { type: "hint", parentRules: ["AI-FP-AWS-BEDROCK-ENDPOINT"] },
  "AI-FP-AWS-BEDROCK-ENDPOINT": { type: "usage", childRules: ["AI-FP-AWS-BEDROCK-IMPORT"] },
  
  // Mistral patterns
  "AI-FP-MISTRAL-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-MISTRAL-MODEL": { type: "hint", parentRules: [] },
  
  // Other SDKs
  "AI-FP-COHERE-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-GROQ-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-LM-STUDIO-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-OLLAMA-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-VLLM-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-LLAMA-CPP-IMPORT": { type: "hint", parentRules: [] },
  
  // LangChain patterns
  "AI-FP-LANGCHAIN-IMPORT": { type: "hint", parentRules: ["AI-FP-LCEL-PATTERN"] },
  "AI-FP-LCEL-PATTERN": { type: "usage", childRules: ["AI-FP-LANGCHAIN-IMPORT"] },
  
  // Agent frameworks
  "AI-FP-LANGGRAPH-IMPORT": { type: "hint", parentRules: ["AG-LANGGRAPH-STATEGRAPH", "AG-LANGGRAPH-INVOKE", "AG-LANGGRAPH-STREAM"] },
  "AI-FP-AUTOGEN-IMPORT": { type: "hint", parentRules: ["AG-A2A-EXECUTOR", "AG-A2A-MESSAGING"] },
  "AI-FP-CREWAI-IMPORT": { type: "hint", parentRules: ["AG-A2A-EXECUTOR", "AG-A2A-MESSAGING"] },
  "AI-FP-SEMANTIC-KERNEL-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-LLAMAINDEX-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-DSPY-IMPORT": { type: "hint", parentRules: [] },
  "AI-FP-HAYSTACK-IMPORT": { type: "hint", parentRules: [] },
  
  // MCP patterns
  "AI-MCP-IMPORT": { type: "hint", parentRules: ["AI-MCP-CLIENT", "AI-MCP-TOOLS"] },
  "AI-MCP-CLIENT": { type: "usage", childRules: ["AI-MCP-IMPORT"] },
  "AI-MCP-TOOLS": { type: "usage", childRules: ["AI-MCP-IMPORT", "AI-MCP-CLIENT"] },
  "AI-MCP-PROTOCOL": { type: "metadata", parentRules: ["AI-MCP-TOOLS", "AI-MCP-CLIENT"] },
  "AI-MCP-CONFIG": { type: "hint", parentRules: ["AI-MCP-TOOLS", "AI-MCP-CLIENT"] },
  "AI-MCP-ENV": { type: "hint", parentRules: ["AI-MCP-TOOLS", "AI-MCP-CLIENT"] },
  
  // Agent patterns
  "AG-ROUTER-ZEROSHOT": { type: "usage" },
  "AG-TOOL-SELECTION-CLASSIFIER": { type: "usage" },
  "AG-LOOP-AUTOEXEC": { type: "usage" },
  "AG-LOOP-WITH-AGENT": { type: "usage" },
  "AG-ASYNC-AGENT-LOOP": { type: "usage" },
  "AG-PLAN-EXEC": { type: "usage" },
  "AG-LANGGRAPH-STATEGRAPH": { type: "usage", childRules: ["AI-FP-LANGGRAPH-IMPORT"] },
  "AG-LANGGRAPH-NODES": { type: "usage", childRules: ["AI-FP-LANGGRAPH-IMPORT", "AG-LANGGRAPH-STATEGRAPH"] },
  "AG-LANGGRAPH-EDGES": { type: "usage", childRules: ["AI-FP-LANGGRAPH-IMPORT", "AG-LANGGRAPH-STATEGRAPH"] },
  "AG-LANGGRAPH-CONDITIONAL-EDGES": { type: "usage", childRules: ["AI-FP-LANGGRAPH-IMPORT", "AG-LANGGRAPH-STATEGRAPH"] },
  "AG-LANGGRAPH-CREATE-AGENT": { type: "usage", childRules: ["AI-FP-LANGGRAPH-IMPORT"] },
  "AG-LANGGRAPH-COMPILE": { type: "usage", childRules: ["AI-FP-LANGGRAPH-IMPORT", "AG-LANGGRAPH-STATEGRAPH"] },
  "AG-LANGGRAPH-INVOKE": { type: "usage", childRules: ["AI-FP-LANGGRAPH-IMPORT", "AG-LANGGRAPH-STATEGRAPH", "AG-LANGGRAPH-COMPILE"] },
  "AG-LANGGRAPH-STREAM": { type: "usage", childRules: ["AI-FP-LANGGRAPH-IMPORT", "AG-LANGGRAPH-STATEGRAPH", "AG-LANGGRAPH-COMPILE"] },
  "AG-LANGCHAIN-INVOKE": { type: "usage", childRules: ["AI-FP-LANGCHAIN-IMPORT"] },
  "AG-TOOL-DECORATOR": { type: "usage" },
  "AG-TOOL-CLASS": { type: "usage" },
  "AG-TOOL-LIST": { type: "usage" },
  "AG-FUNCTION-TOOL-TYPE": { type: "usage", childRules: ["AI-FP-OPENAI-FUNCTION-CALLING"] },
  "AG-A2A-FRAMEWORK": { type: "hint", parentRules: ["AG-A2A-EXECUTOR", "AG-A2A-MESSAGING"] },
  "AG-A2A-EXECUTOR": { type: "usage", childRules: ["AG-A2A-FRAMEWORK", "AI-FP-AUTOGEN-IMPORT", "AI-FP-CREWAI-IMPORT"] },
  "AG-A2A-MESSAGING": { type: "usage", childRules: ["AG-A2A-FRAMEWORK", "AI-FP-AUTOGEN-IMPORT", "AI-FP-CREWAI-IMPORT"] },
  "AG-A2A-ORCHESTRATION": { type: "hint", parentRules: ["AG-A2A-EXECUTOR", "AG-A2A-MESSAGING"] },
  
  // RAG patterns
  "RAG-VECTOR-DB": { type: "hint", parentRules: ["RAG-RETRIEVAL", "RAG-CHAIN", "RAG-LANGCHAIN-VECTORSTORE"] },
  "RAG-EMBEDDINGS": { type: "hint", parentRules: ["RAG-RETRIEVAL", "RAG-CHAIN", "RAG-LANGCHAIN-VECTORSTORE"] },
  "RAG-TEXT-SPLITTER": { type: "hint", parentRules: ["RAG-RETRIEVAL", "RAG-CHAIN", "RAG-LANGCHAIN-VECTORSTORE"] },
  "RAG-RETRIEVAL": { type: "usage", childRules: ["RAG-VECTOR-DB", "RAG-EMBEDDINGS", "RAG-TEXT-SPLITTER"] },
  "RAG-CHAIN": { type: "usage", childRules: ["RAG-VECTOR-DB", "RAG-EMBEDDINGS", "RAG-TEXT-SPLITTER", "RAG-RETRIEVAL"] },
  "RAG-LANGCHAIN-VECTORSTORE": { type: "usage", childRules: ["RAG-VECTOR-DB", "RAG-EMBEDDINGS"] },
  "RAG-CONTEXT-INJECTION": { type: "usage", childRules: ["RAG-RETRIEVAL", "RAG-CHAIN"] },
};

/**
 * Groups findings by file and relatedness
 * - Groups findings in the same file that are related (import + usage)
 * - Deduplicates identical findings
 * - Creates hierarchical structure (usage = parent, hints = children)
 */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  // First, deduplicate identical findings (same file, rule, line)
  const deduplicated = deduplicateFindings(findings);
  
  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const finding of deduplicated) {
    const fileFindings = byFile.get(finding.file) || [];
    fileFindings.push(finding);
    byFile.set(finding.file, fileFindings);
  }
  
  const groups: FindingGroup[] = [];
  
  for (const [file, fileFindings] of byFile.entries()) {
    // Group related findings within the file
    const fileGroups = groupFileFindings(file, fileFindings);
    groups.push(...fileGroups);
  }
  
  // Phase 2: compute composite scores and adjust severities
  for (const group of groups) {
    const contributing: NonNullable<FindingGroup["contributingSignals"]> = [];
    const primaryRel = RULE_RELATIONSHIPS[group.primaryFinding.ruleId];
    const primaryRole = primaryRel?.type ?? "usage";
    const primaryWeight = baseWeightForRole(primaryRole) * group.primaryFinding.confidence;
    contributing.push({
      ruleId: group.primaryFinding.ruleId,
      weight: baseWeightForRole(primaryRole),
      confidence: group.primaryFinding.confidence,
      role: primaryRole
    });
    let score = primaryWeight;
    let usageCount = primaryRole === "usage" ? 1 : 0;
    let hintCount = primaryRole === "hint" ? 1 : 0;
    let metadataCount = primaryRole === "metadata" ? 1 : 0;
    // Add related findings with diminishing returns
    const MAX_RELATED = getRelatedCap();
    const relatedLimited = group.relatedFindings.slice(0, MAX_RELATED);
    relatedLimited.forEach((f, idx) => {
      const rel = RULE_RELATIONSHIPS[f.ruleId];
      const role = rel?.type ?? "hint";
      const w = baseWeightForRole(role);
      // diminishing factor for later signals
      const diminish = 1 / (1 + idx * 0.35);
      score += w * f.confidence * diminish;
      contributing.push({ ruleId: f.ruleId, weight: w, confidence: f.confidence, role });
      if (role === "usage") usageCount += 1;
      if (role === "hint") hintCount += 1;
      if (role === "metadata") metadataCount += 1;
    });
    // Boosts & demotions via config
    score = applyBoosts(score, usageCount, hintCount, metadataCount);
    score = applyDemotions(score, {
      isTestOrExamplePath: isTestOrExamplePath(group.file),
      loopOnlyWithoutInvoke: isLoopOnlyGroup(group, contributing),
      isMockLikePath: isMockLikePath(group.file)
    });
    // Clamp to [0,1]
    score = Math.max(0, Math.min(1, score));
    group.compositeScore = score;
    group.contributingSignals = contributing;
    // Map composite score to severity if higher than current
    const mapped = scoreToSeverity(score);
    // choose the max of existing severity and mapped severity
    group.severity = severityToNumber(mapped) > severityToNumber(group.severity) ? mapped : group.severity;
  }
  return groups;
}

function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique: Finding[] = [];
  
  for (const finding of findings) {
    // Create a key: file + ruleId + line + evidence (first 50 chars)
    const key = `${finding.file}:${finding.ruleId}:${finding.line ?? "null"}:${finding.evidence.slice(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(finding);
    }
  }
  
  return unique;
}

function groupFileFindings(file: string, findings: Finding[]): FindingGroup[] {
  const groups: FindingGroup[] = [];
  const processed = new Set<string>();
  
  // Find usage findings first (these become primary)
  const usageFindings = findings.filter(f => {
    const rel = RULE_RELATIONSHIPS[f.ruleId];
    return rel?.type === "usage";
  });
  
  // Find hint findings
  const hintFindings = findings.filter(f => {
    const rel = RULE_RELATIONSHIPS[f.ruleId];
    return rel?.type === "hint";
  });
  
  // Find metadata findings (low priority, can be grouped with anything)
  const metadataFindings = findings.filter(f => {
    const rel = RULE_RELATIONSHIPS[f.ruleId];
    return rel?.type === "metadata";
  });
  
  // Group usage findings by rule type (same rule in same file = one group)
  const usageByRule = new Map<string, Finding[]>();
  for (const usage of usageFindings) {
    const existing = usageByRule.get(usage.ruleId) || [];
    existing.push(usage);
    usageByRule.set(usage.ruleId, existing);
  }
  
  // Create one group per usage rule type, combining all findings of that type
  for (const [ruleId, ruleUsageFindings] of usageByRule.entries()) {
    if (ruleUsageFindings.length === 0) continue;
    
    // Choose a primary based on severity, confidence, and invoke/endpoint preference
    const primary = ruleUsageFindings.reduce((best, cand) => {
      const bestScore = primaryCandidateScore(best);
      const candScore = primaryCandidateScore(cand);
      return candScore > bestScore ? cand : best;
    });
    
    // Collect all related findings for this rule type
    const relatedSet = new Set<string>(); // Use Set to deduplicate by ID
    const related: Finding[] = [];
    const rel = RULE_RELATIONSHIPS[ruleId];
    
    // Find related hints for this usage rule type
    if (rel?.childRules) {
      for (const hintRuleId of rel.childRules) {
        const hints = hintFindings.filter(f => f.ruleId === hintRuleId);
        for (const hint of hints) {
          if (!relatedSet.has(hint.id)) {
            relatedSet.add(hint.id);
            related.push(hint);
            processed.add(hint.id);
          }
        }
      }
    }
    
    // Add metadata findings related to this usage rule type
    for (const meta of metadataFindings) {
      const metaRel = RULE_RELATIONSHIPS[meta.ruleId];
      if (metaRel?.parentRules?.includes(ruleId)) {
        if (!relatedSet.has(meta.id)) {
          relatedSet.add(meta.id);
          related.push(meta);
          processed.add(meta.id);
        }
      }
    }
    
    // Mark all usage findings of this type as processed
    ruleUsageFindings.forEach(u => processed.add(u.id));
    
    // Calculate risk boost: +1 severity level if both usage and hints found
    const riskBoost = related.length > 0 ? 1 : 0;
    const severity = boostSeverity(primary.severity, riskBoost);
    
    // If multiple usage findings of same type, include a limited subset as related (prefer proximity to primary)
    const otherUsagesAll = ruleUsageFindings.filter(u => u.id !== primary.id);
    const otherUsages = otherUsagesAll
      .sort((a, b) => Math.abs((a.line ?? 0) - (primary.line ?? 0)) - Math.abs((b.line ?? 0) - (primary.line ?? 0)))
      .slice(0, 3);
    
    // Compute composite score and apply min-evidence floor for non-usage groups later
    const groupsBeforePushLen = groups.length;
    const contributing: NonNullable<FindingGroup["contributingSignals"]> = [];
    const primaryRel = RULE_RELATIONSHIPS[primary.ruleId];
    const primaryRole = primaryRel?.type ?? "usage";
    let usageCount = primaryRole === "usage" ? 1 : 0;
    let hintCount = primaryRole === "hint" ? 1 : 0;
    let metadataCount = primaryRole === "metadata" ? 1 : 0;
    const MAX_RELATED = getRelatedCap();
    const relatedLimited = [...related, ...otherUsages].slice(0, MAX_RELATED);
    let score = baseWeightForRole(primaryRole) * primary.confidence;
    contributing.push({ ruleId: primary.ruleId, weight: baseWeightForRole(primaryRole), confidence: primary.confidence, role: primaryRole });
    relatedLimited.forEach((f, idx) => {
      const relType = RULE_RELATIONSHIPS[f.ruleId]?.type ?? "hint";
      const w = baseWeightForRole(relType);
      const diminish = 1 / (1 + idx * 0.35);
      score += w * f.confidence * diminish;
      contributing.push({ ruleId: f.ruleId, weight: w, confidence: f.confidence, role: relType });
      if (relType === "usage") usageCount++;
      if (relType === "hint") hintCount++;
      if (relType === "metadata") metadataCount++;
    });
    score = applyBoosts(score, usageCount, hintCount, metadataCount);
    score = applyDemotions(score, {
      isTestOrExamplePath: isTestOrExamplePath(primary.file),
      loopOnlyWithoutInvoke: isLoopOnlyGroup({ id: "", primaryFinding: primary, relatedFindings: relatedLimited, file, severity, category: primary.category, riskBoost, } as any, contributing),
      isMockLikePath: isMockLikePath(primary.file)
    });
    const thresholds = getScoringConfig().thresholds;
    const mapped = scoreToSeverity(Math.max(0, Math.min(1, score)));
    const finalSeverity = severityToNumber(mapped) > severityToNumber(severity) ? mapped : severity;
    // enforce min-evidence floor for non-usage groups (shouldn't apply here since we are in usage grouping)
    // push group
    groups.push({
      id: `group-${file}-${ruleId}`,
      primaryFinding: primary,
      relatedFindings: relatedLimited,
      file: primary.file,
      severity: finalSeverity,
      category: primary.category,
      riskBoost,
      compositeScore: Math.max(0, Math.min(1, score)),
      contributingSignals: contributing
    });
  }
  
  // Handle standalone hints (no usage found)
  for (const hint of hintFindings) {
    if (processed.has(hint.id)) continue;
    const thresholds2 = getScoringConfig().thresholds;
    const comp = baseWeightForRole("hint") * (hint.confidence ?? 0.5);
    if (comp < (thresholds2.minGroup ?? 0)) {
      processed.add(hint.id);
      continue;
    }
    groups.push({
      id: `group-${hint.id}`,
      primaryFinding: hint,
      relatedFindings: [],
      file: hint.file,
      severity: hint.severity,
      category: hint.category,
      riskBoost: 0,
      compositeScore: comp,
      contributingSignals: [{ ruleId: hint.ruleId, weight: baseWeightForRole("hint"), confidence: hint.confidence, role: "hint" }]
    });
    processed.add(hint.id);
  }
  
  // Handle metadata findings that weren't grouped
  for (const meta of metadataFindings) {
    if (processed.has(meta.id)) continue;
    
    groups.push({
      id: `group-${meta.id}`,
      primaryFinding: meta,
      relatedFindings: [],
      file: meta.file,
      severity: meta.severity,
      category: meta.category,
      riskBoost: 0
    });
    processed.add(meta.id);
  }
  
  // Handle any remaining findings (rules not in relationships map)
  for (const finding of findings) {
    if (processed.has(finding.id)) continue;
    
    groups.push({
      id: `group-${finding.id}`,
      primaryFinding: finding,
      relatedFindings: [],
      file: finding.file,
      severity: finding.severity,
      category: finding.category,
      riskBoost: 0
    });
    processed.add(finding.id);
  }
  
  return groups;
}

function severityToNumber(severity: Severity): number {
  const map: Record<Severity, number> = {
    low: 1,
    moderate: 2,
    high: 3,
    critical: 4
  };
  return map[severity] || 0;
}

function boostSeverity(severity: Severity, boost: number): Severity {
  if (boost === 0) return severity;
  
  const levels: Severity[] = ["low", "moderate", "high", "critical"];
  const current = levels.indexOf(severity);
  const boosted = Math.min(current + boost, levels.length - 1);
  return levels[boosted] as Severity;
}

function primaryCandidateScore(f: Finding): number {
  // Base on severity + confidence; prefer invoke/stream/endpoint rules slightly
  const sev = severityToNumber(f.severity);
  const base = sev * 0.6 + (f.confidence ?? 0) * 0.4;
  const id = f.ruleId;
  const prefer = (
    id === "AG-LANGGRAPH-INVOKE" ||
    id === "AG-LANGGRAPH-STREAM" ||
    id === "AI-FP-OPENAI-ENDPOINT" ||
    id === "AG-LANGCHAIN-INVOKE"
  ) ? 0.15 : 0;
  return base + prefer;
}

function getRelatedCap(): number {
  try {
    return getScoringConfig().caps.perGroupRelated;
  } catch {
    return 6;
  }
}

function isTestOrExamplePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.includes("__tests__") ||
    lower.includes("/example/") ||
    lower.includes("/examples/")
  );
}

function isLoopOnlyGroup(
  group: FindingGroup,
  signals: NonNullable<FindingGroup["contributingSignals"]>
): boolean {
  const loopRuleIds = new Set([
    "AG-LOOP-AUTOEXEC",
    "AG-LOOP-WITH-AGENT",
    "AG-ASYNC-AGENT-LOOP"
  ]);
  const corroboratingUsage = new Set([
    "AG-LANGGRAPH-INVOKE",
    "AG-LANGGRAPH-STREAM",
    "AG-LANGCHAIN-INVOKE"
  ]);
  const allRuleIds = new Set<string>([group.primaryFinding.ruleId]);
  signals.forEach(s => allRuleIds.add(s.ruleId));
  const hasLoop = [...allRuleIds].some(id => loopRuleIds.has(id));
  const hasCorroboration = [...allRuleIds].some(id => corroboratingUsage.has(id));
  return hasLoop && !hasCorroboration;
}

function isMockLikePath(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    lower.includes("/__mocks__/") ||
    lower.includes("/mocks/") ||
    lower.includes("/mock/") ||
    lower.includes("/stubs/") ||
    lower.includes("/fixtures/") ||
    lower.includes("/samples/")
  );
}

/**
 * Flatten groups back to findings for backward compatibility
 * Used when we need the original findings array
 */
export function flattenGroups(groups: FindingGroup[]): Finding[] {
  const findings: Finding[] = [];
  for (const group of groups) {
    findings.push(group.primaryFinding);
    findings.push(...group.relatedFindings);
  }
  return findings;
}

