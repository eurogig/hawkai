#!/usr/bin/env node
/**
 * Test Reachability Graph Functionality
 * 
 * Validates reachability graph building, call-edge extraction,
 * confidence propagation, and risky path detection.
 * 
 * Usage:
 *   npx tsx tests/test-graph.ts
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { parseGitHubUrl } from "../src/core/url.js";
import { downloadRepoArchive, resolveDefaultBranch } from "../src/core/github.js";
import { compileRules } from "../src/core/rules.js";
import { createReport, scanArchive } from "../src/core/scanner.js";
import { buildCoarseGraph, enrichGraphWithCallEdges, propagateConfidence, detectRiskyPaths, toMermaid } from "../src/core/reachability.js";
import { unzipArchive, decodeUtf8, isLikelyBinary } from "../src/core/unzip.js";
import type { ScanContext, RuleDefinition } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const __rootDir = resolve(__dirname, "..");

async function loadRulesFromFS(): Promise<{ rules: RuleDefinition[] }> {
  const publicDir = resolve(__rootDir, "public");
  const rulesDir = resolve(publicDir, "rules");
  
  const manifestPath = resolve(rulesDir, "index.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { packs: string[]; metadata: string };

  const rules: RuleDefinition[] = [];
  for (const pack of manifest.packs) {
    const packPath = resolve(rulesDir, pack);
    if (existsSync(packPath)) {
      const content = readFileSync(packPath, "utf-8");
      const packRules = YAML.parse(content) as RuleDefinition[];
      rules.push(...packRules);
    }
  }

  return { rules };
}

interface GraphTestResult {
  repo: string;
  findings: number;
  groups: number;
  graphNodes: number;
  graphEdges: number;
  riskyPaths: number;
  riskyPathsCritical: number;
  riskyPathsHigh: number;
  hasToolSource: boolean;
  hasToolSink: boolean;
  hasModelTransform: boolean;
  mermaidSnippet?: string;
}

async function testGraphForRepo(url: string): Promise<GraphTestResult> {
  console.log(`\n[TEST] Testing reachability graph for ${url}...`);
  
  const parsed = parseGitHubUrl(url);
  const context: ScanContext = {
    ...parsed,
    branch: parsed.branch
  };

  if (!context.branch) {
    context.branch = await resolveDefaultBranch(context);
  }

  // Download archive
  const { buffer } = await downloadRepoArchive(context);
  
  // Load rules and scan
  const { rules } = await loadRulesFromFS();
  const compiledRules = compileRules(rules);
  const result = scanArchive(context, buffer, compiledRules);
  const report = createReport(context, result);
  const groups = report.groups || [];

  // Build coarse graph
  let graph = buildCoarseGraph(groups);

  // Enrich with call edges
  const fileContents = new Map<string, string>();
  const filesWithFindings = new Set<string>();
  
  for (const group of groups) {
    if (group.primaryFinding.file) filesWithFindings.add(group.primaryFinding.file);
    for (const r of group.relatedFindings) {
      if (r.file) filesWithFindings.add(r.file);
    }
  }
  
  const entries = unzipArchive(buffer);
  for (const entry of entries) {
    if (filesWithFindings.has(entry.path) && !isLikelyBinary(entry.data)) {
      try {
        const text = decodeUtf8(entry.data);
        fileContents.set(entry.path, text);
      } catch {
        // Skip
      }
    }
  }
  
  graph = enrichGraphWithCallEdges(graph, groups, fileContents);
  
  // Propagate confidence
  graph = propagateConfidence(graph);
  
  // Detect risky paths
  const riskyPaths = detectRiskyPaths(graph);

  // Analyze risky paths
  const hasToolSource = riskyPaths.some(p => 
    /tool|uses_tool|ag-tool|ag-function/i.test(p.source.label || p.source.id)
  );
  const hasToolSink = riskyPaths.some(p => 
    /tool|uses_tool|ag-tool|ag-function/i.test(p.sink.label || p.sink.id)
  );
  const hasModelTransform = riskyPaths.some(p => 
    p.transforms.length > 0 && p.transforms.some(t => 
      /openai|anthropic|langchain|langgraph|agent|model/i.test(t.label || t.id)
    )
  );

  // Generate Mermaid snippet for top risky path
  let mermaidSnippet: string | undefined;
  if (riskyPaths.length > 0) {
    const topPath = riskyPaths[0];
    const topPathGraph = {
      nodes: topPath.path,
      edges: [] as any[]
    };
    // Create edges between consecutive nodes in path
    for (let i = 0; i < topPath.path.length - 1; i++) {
      topPathGraph.edges.push({
        from: topPath.path[i].id,
        to: topPath.path[i + 1].id,
        kind: "path",
        label: i === 0 ? "source" : i === topPath.path.length - 2 ? "sink" : "transform"
      });
    }
    mermaidSnippet = toMermaid(topPathGraph as any).split('\n').slice(0, 20).join('\n');
  }

  const testResult: GraphTestResult = {
    repo: url,
    findings: result.findings.length,
    groups: groups.length,
    graphNodes: graph.nodes.length,
    graphEdges: graph.edges.length,
    riskyPaths: riskyPaths.length,
    riskyPathsCritical: riskyPaths.filter(p => p.riskLevel === "critical").length,
    riskyPathsHigh: riskyPaths.filter(p => p.riskLevel === "high").length,
    hasToolSource,
    hasToolSink,
    hasModelTransform,
    mermaidSnippet
  };

  return testResult;
}

async function main() {
  // Test against a few curated repos
  const testRepos = [
    "https://github.com/relari-ai/agent-examples",
    "https://github.com/langchain-ai/langgraph"
  ];

  const results: GraphTestResult[] = [];

  for (const repo of testRepos) {
    try {
      const result = await testGraphForRepo(repo);
      results.push(result);
      
      console.log(`  ✓ Findings: ${result.findings}`);
      console.log(`  ✓ Groups: ${result.groups}`);
      console.log(`  ✓ Graph nodes: ${result.graphNodes}, edges: ${result.graphEdges}`);
      console.log(`  ✓ Risky paths: ${result.riskyPaths} (${result.riskyPathsCritical} critical, ${result.riskyPathsHigh} high)`);
      console.log(`  ✓ Tool→Model→Tool pattern: ${result.hasToolSource && result.hasModelTransform && result.hasToolSink ? "YES" : "NO"}`);
      
    } catch (error) {
      console.error(`  ✗ Failed: ${(error as Error).message}`);
    }
  }

  // Save results
  const resultsPath = resolve(__dirname, "graph-test-results.json");
  writeFileSync(resultsPath, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\n[TEST] Results saved to ${resultsPath}`);

  // Summary
  console.log("\n=== Graph Test Summary ===");
  console.log(`Total repos tested: ${results.length}`);
  console.log(`Total risky paths found: ${results.reduce((sum, r) => sum + r.riskyPaths, 0)}`);
  console.log(`Tool→Model→Tool patterns detected: ${results.filter(r => r.hasToolSource && r.hasModelTransform && r.hasToolSink).length}`);

  // Validate expectations
  const hasToolPattern = results.some(r => r.hasToolSource && r.hasModelTransform && r.hasToolSink);
  if (!hasToolPattern && results.length > 0) {
    console.warn("\n⚠ Warning: No tool→model→tool patterns detected in test repos");
  }

  if (results.length === 0) {
    console.error("\n✗ No successful tests");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[ERROR]", error);
  process.exit(1);
});

