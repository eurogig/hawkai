import type { Finding, FindingGroup, Severity } from "@/types";

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
  "AI-FP-OPENAI-IMPORT": { type: "hint", parentRules: ["AI-FP-OPENAI-CLIENT", "AI-FP-CHAT-COMPLETION"] },
  "AI-FP-OPENAI-CLIENT": { type: "usage", childRules: ["AI-FP-OPENAI-IMPORT"] },
  "AI-FP-CHAT-COMPLETION": { type: "usage", childRules: ["AI-FP-OPENAI-IMPORT", "AI-FP-OPENAI-CLIENT"] },
  "AI-FP-GPT-MODEL": { type: "hint", parentRules: ["AI-FP-CHAT-COMPLETION"] },
  
  // Anthropic patterns
  "AI-FP-ANTHROPIC-IMPORT": { type: "hint", parentRules: [] },
  
  // LangChain patterns
  "AI-FP-LANGCHAIN-IMPORT": { type: "hint", parentRules: [] },
  
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
  "AG-PLAN-EXEC": { type: "usage" },
  "AG-A2A-FRAMEWORK": { type: "hint", parentRules: ["AG-A2A-EXECUTOR", "AG-A2A-MESSAGING"] },
  "AG-A2A-EXECUTOR": { type: "usage", childRules: ["AG-A2A-FRAMEWORK"] },
  "AG-A2A-MESSAGING": { type: "usage", childRules: ["AG-A2A-FRAMEWORK"] },
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
    
    // Use the first finding as primary (or highest severity)
    const primary = ruleUsageFindings.reduce((a, b) => 
      severityToNumber(a.severity) > severityToNumber(b.severity) ? a : b
    );
    
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
    
    // If multiple usage findings of same type, include them as related
    const otherUsages = ruleUsageFindings.filter(u => u.id !== primary.id);
    
    groups.push({
      id: `group-${file}-${ruleId}`,
      primaryFinding: primary,
      relatedFindings: [...related, ...otherUsages], // Include other same-type usages and hints
      file: primary.file,
      severity,
      category: primary.category,
      riskBoost
    });
  }
  
  // Handle standalone hints (no usage found)
  for (const hint of hintFindings) {
    if (processed.has(hint.id)) continue;
    
    groups.push({
      id: `group-${hint.id}`,
      primaryFinding: hint,
      relatedFindings: [],
      file: hint.file,
      severity: hint.severity,
      category: hint.category,
      riskBoost: 0
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

