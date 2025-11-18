#!/usr/bin/env node
/**
 * HawkAI CLI Scanner
 * 
 * Command-line tool to test rules against GitHub repositories
 * Usage: npm run scan -- <github-url> [--branch <branch>] [--output <json|text>]
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import type { RuleDefinition, RulePackIndex, ScanContext, Finding } from "../src/types.js";
import { parseGitHubUrl, repoSlug } from "../src/core/url.js";
import { downloadRepoArchive, resolveDefaultBranch } from "../src/core/github.js";
import { compileRules } from "../src/core/rules.js";
import { createReport, scanArchive } from "../src/core/scanner.js";
import { unzipArchive, decodeUtf8, isLikelyBinary } from "../src/core/unzip.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CLIArgs {
  url: string;
  branch?: string;
  output?: "json" | "text" | "summary";
  verbose?: boolean;
  graph?: "json" | "dot" | "mermaid";
  graphOnly?: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const parsed: CLIArgs = {
    url: "",
    output: "summary",
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--branch" || arg === "-b") {
      parsed.branch = args[++i];
    } else if (arg === "--output" || arg === "-o") {
      parsed.output = args[++i] as "json" | "text" | "summary";
    } else if (arg === "--verbose" || arg === "-v") {
      parsed.verbose = true;
    } else if (arg === "--graph") {
      parsed.graph = args[++i] as "json" | "dot" | "mermaid";
    } else if (arg === "--graph-only") {
      parsed.graphOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && !parsed.url) {
      parsed.url = arg;
    }
  }

  if (!parsed.url) {
    console.error("Error: GitHub URL is required");
    printHelp();
    process.exit(1);
  }

  return parsed;
}

function printHelp() {
  console.log(`
HawkAI CLI Scanner

Usage:
  npm run scan -- <github-url> [options]

Options:
  -b, --branch <branch>    Specify branch to scan (default: auto-detect)
  -o, --output <format>    Output format: json, text, or summary (default: summary)
      --graph <format>     Emit reachability graph: json, dot, mermaid (optional)
      --graph-only         Output only the graph (requires --graph)
  -v, --verbose            Show detailed progress
  -h, --help               Show this help message

Examples:
  npm run scan -- https://github.com/user/repo
  npm run scan -- https://github.com/user/repo --branch main --output json
  npm run scan -- https://github.com/user/repo --graph mermaid --graph-only
  npm run scan -- https://github.com/user/repo --verbose

Output Formats:
  - summary: Human-readable summary with counts and key findings
  - text: Detailed text output with all findings
  - json: Full JSON report
`);
}

function log(message: string, verbose = false) {
  if (verbose || !message.startsWith("[DEBUG]")) {
    console.log(message);
  }
}

async function loadRulesFromFS(): Promise<{ rules: RuleDefinition[]; owasp: RulePackIndex["owasp"] }> {
  const publicDir = resolve(__dirname, "../public");
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

  const owaspPath = resolve(rulesDir, manifest.metadata);
  const owasp = existsSync(owaspPath)
    ? (YAML.parse(readFileSync(owaspPath, "utf-8")) as RulePackIndex["owasp"])
    : {};

  return { rules, owasp };
}

function formatSummary(report: any, findings: Finding[]): string {
  const lines: string[] = [];
  lines.push("\n" + "=".repeat(80));
  lines.push(`HawkAI Scan Report: ${report.repo}@${report.branch}`);
  lines.push("=".repeat(80));
  
  lines.push(`\nScan Statistics:`);
  lines.push(`  Files: ${report.stats.files} (scanned: ${report.stats.scanned}, skipped: ${report.stats.skipped})`);
  lines.push(`  Duration: ${report.stats.durationMs}ms`);
  
  lines.push(`\nRisk Score: ${report.score.overall}/100 (${report.score.riskLevel})`);
  
  if (report.inventory && Object.keys(report.inventory).length > 0) {
    lines.push(`\nAI Inventory:`);
    if (report.inventory.sdks?.length) {
      lines.push(`  SDKs: ${report.inventory.sdks.join(", ")}`);
    }
    if (report.inventory.models?.length) {
      lines.push(`  Models: ${report.inventory.models.join(", ")}`);
    }
    if (report.inventory.frameworks?.length) {
      lines.push(`  Frameworks: ${report.inventory.frameworks.join(", ")}`);
    }
    if (report.inventory.tools?.length) {
      lines.push(`  Tools: ${report.inventory.tools.join(", ")}`);
    }
  }
  
  const bySeverity = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  lines.push(`\nFindings Summary:`);
  lines.push(`  Critical: ${bySeverity.critical || 0}`);
  lines.push(`  High: ${bySeverity.high || 0}`);
  lines.push(`  Moderate: ${bySeverity.moderate || 0}`);
  lines.push(`  Low: ${bySeverity.low || 0}`);
  lines.push(`  Total: ${findings.length}`);
  
  if (findings.length > 0) {
    lines.push(`\nTop Findings (first 10):`);
    findings.slice(0, 10).forEach((finding, i) => {
      lines.push(`\n  ${i + 1}. [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push(`     Rule ID: ${finding.ruleId}`);
      lines.push(`     File: ${finding.file}${finding.line ? `:${finding.line}` : ""}`);
      if (finding.evidence) {
        const evidence = finding.evidence.length > 60 
          ? finding.evidence.substring(0, 60) + "..." 
          : finding.evidence;
        lines.push(`     Evidence: ${evidence}`);
      }
      // Show brief "why" summary using grouped signals if available
      const group = report.groups?.find((g: any) => g.primaryFinding?.id === finding.id);
      if (group?.compositeScore != null) {
        const scorePct = Math.round(group.compositeScore * 100);
        lines.push(`     Confidence: ${scorePct}% (composite)`);
        if (Array.isArray(group.contributingSignals) && group.contributingSignals.length > 0) {
          const top = group.contributingSignals
            .slice(0, 3)
            .map((s: any) => `${s.role}:${s.ruleId}`)
            .join(", ");
          lines.push(`     Why: ${top}`);
        }
      }
    });
    
    if (findings.length > 10) {
      lines.push(`\n  ... and ${findings.length - 10} more findings`);
    }
  }
  
  lines.push("\n" + "=".repeat(80));
  return lines.join("\n");
}

function formatText(report: any, findings: Finding[]): string {
  const lines: string[] = [];
  lines.push(formatSummary(report, findings));
  
  if (findings.length > 0) {
    lines.push(`\nAll Findings:\n`);
    findings.forEach((finding, i) => {
      lines.push(`\n${i + 1}. [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push(`   Rule ID: ${finding.ruleId}`);
      lines.push(`   Category: ${finding.category}`);
      lines.push(`   File: ${finding.file}${finding.line ? `:${finding.line}` : ""}`);
      if (finding.evidence) {
        lines.push(`   Evidence: ${finding.evidence}`);
      }
      if (finding.remediation) {
        lines.push(`   Remediation: ${finding.remediation}`);
      }
      if (finding.owasp?.length) {
        lines.push(`   OWASP: ${finding.owasp.join(", ")}`);
      }
      lines.push(`   Confidence: ${(finding.confidence * 100).toFixed(0)}%`);
      // Include composite scoring details if available
      const group = report.groups?.find((g: any) => g.primaryFinding?.id === finding.id);
      if (group?.compositeScore != null) {
        const scorePct = Math.round(group.compositeScore * 100);
        lines.push(`   Composite: ${scorePct}%`);
        if (Array.isArray(group.contributingSignals) && group.contributingSignals.length > 0) {
          const top = group.contributingSignals
            .slice(0, 5)
            .map((s: any) => `${s.role}:${s.ruleId}(${Math.round(s.confidence * 100)}%)`)
            .join(", ");
          lines.push(`   Signals: ${top}`);
        }
      }
    });
  }
  
  return lines.join("\n");
}

async function main() {
  const args = parseArgs();
  let verbose = args.verbose;
  
  try {
    log(`[INFO] Parsing GitHub URL: ${args.url}`);
    const parsed = parseGitHubUrl(args.url);
    const context: ScanContext = {
      ...parsed,
      branch: args.branch ?? parsed.branch
    };

    if (!args.branch) {
      log(`[INFO] Resolving default branch...`);
      context.branch = await resolveDefaultBranch(context);
    }
    
    log(`[INFO] Scanning ${repoSlug(context)}@${context.branch}`);
    log(`[INFO] Downloading repository archive...`, verbose);
    
    const { buffer, branch: downloadedBranch } = await downloadRepoArchive(context, {
      onProgress(received, total) {
        if (verbose && total) {
          const percent = ((received / total) * 100).toFixed(1);
          log(`[DEBUG] Download progress: ${percent}% (${(received / 1024 / 1024).toFixed(2)} MB / ${(total / 1024 / 1024).toFixed(2)} MB)`);
        }
      }
    });
    context.branch = downloadedBranch;
    
    log(`[INFO] Loading rule packs...`, verbose);
    const { rules: ruleDefs, owasp } = await loadRulesFromFS();
    const compiledRules = compileRules(ruleDefs);
    log(`[INFO] Loaded ${compiledRules.length} rules`, verbose);
    
    log(`[INFO] Scanning archive...`, verbose);
    const startTime = Date.now();
    let scannedFiles: string[] = [];
    const result = scanArchive(context, buffer, compiledRules, {
      onProgress({ currentFile, scanned, total }) {
        if (verbose) {
          scannedFiles.push(currentFile);
          if (scanned % 50 === 0 || scanned === total) {
            log(`[DEBUG] Scanned ${scanned}/${total} files`);
          }
        }
      }
    });
    
    if (verbose && scannedFiles.length > 0) {
      log(`[DEBUG] Total files scanned: ${scannedFiles.length}`);
      log(`[DEBUG] Sample files scanned (first 10): ${scannedFiles.slice(0, 10).join(", ")}`);
      const pyFiles = scannedFiles.filter(f => f.endsWith('.py'));
      if (pyFiles.length > 0) {
        log(`[DEBUG] Python files found (${pyFiles.length}): ${pyFiles.slice(0, 10).join(", ")}`);
        
        // Test a specific pattern against a known file
        const testFile = pyFiles.find(f => f.includes('graph.py') || f.includes('tools.py'));
        if (testFile) {
          log(`[DEBUG] Found test file: ${testFile}`);
        }
      }
    }
    
    result.stats.durationMs = Date.now() - startTime;
    const report = createReport(context, result);
    
    log(`[INFO] Scan complete! Found ${result.findings.length} findings`);
    
    // Build reachability graph and red-teaming plans (always, for debugging and features)
    let graphOutput = "";
    let riskyPaths: any[] = [];
    let redTeamingPlans: any[] = [];
    let graph: any = null;
    
    // Always build graph (needed for red-teaming plans)
    {
      const { buildCoarseGraph, enrichGraphWithCallEdges, propagateConfidence, detectRiskyPaths, toDot, toMermaid } = await import("../src/core/reachability.js");
      const { generateRedTeamingPlans } = await import("../src/core/redTeaming.js");
      const groups = report.groups || [];
      let tempGraph = buildCoarseGraph(groups);
      
      // Enrich with call edges if we have file contents
      if (groups.length > 0) {
        const fileContents = new Map<string, string>();
        const filesWithFindings = new Set<string>();
        
        // Collect files that have findings
        for (const group of groups) {
          if (group.primaryFinding.file) filesWithFindings.add(group.primaryFinding.file);
          for (const r of group.relatedFindings) {
            if (r.file) filesWithFindings.add(r.file);
          }
        }
        
        // Extract file contents from archive
        const entries = unzipArchive(buffer);
        for (const entry of entries) {
          if (filesWithFindings.has(entry.path) && !isLikelyBinary(entry.data)) {
            try {
              const text = decodeUtf8(entry.data);
              fileContents.set(entry.path, text);
            } catch {
              // Skip files that can't be decoded
            }
          }
        }
        
        // Enrich graph with call edges
        tempGraph = enrichGraphWithCallEdges(tempGraph, groups, fileContents);
        
        // Propagate confidence along paths and update edge weights
        tempGraph = propagateConfidence(tempGraph);
        
        // Detect risky paths
        riskyPaths = detectRiskyPaths(tempGraph);
        
        // Generate red-teaming plans
        if (riskyPaths.length > 0) {
          // Use the OWASP metadata we already loaded from filesystem
          redTeamingPlans = generateRedTeamingPlans(riskyPaths, report, owasp);
        }
      }
      
      // Store graph for output
      graph = tempGraph;
      
      // Format graph output if requested
      if (args.graph === "json") {
        graphOutput = JSON.stringify({ graph, riskyPaths, redTeamingPlans }, null, 2);
      } else if (args.graph === "dot") {
        graphOutput = toDot(graph);
      } else if (args.graph === "mermaid") {
        graphOutput = toMermaid(graph);
      }
    }

    if (args.graphOnly && args.graph) {
      console.log(graphOutput);
      return;
    }
    
    // Always show red-teaming plans in summary/text output (not just when --graph is specified)
    if (redTeamingPlans.length === 0 && riskyPaths.length > 0) {
      // Try to generate plans if we have risky paths but no plans yet
      const { generateRedTeamingPlans } = await import("../src/core/redTeaming.js");
      redTeamingPlans = generateRedTeamingPlans(riskyPaths, report, owasp);
    }

    // Flatten findings from groups for output
    const allFindings: Finding[] = [];
    
    // report.findings might be raw findings or groups depending on structure
    if (report.groups && Array.isArray(report.groups)) {
      // Use grouped findings
      report.groups.forEach(group => {
        if (group.primaryFinding) {
          allFindings.push(group.primaryFinding);
        }
        if (group.relatedFindings) {
          allFindings.push(...group.relatedFindings.filter(f => f !== undefined));
        }
      });
    } else if (Array.isArray(report.findings) && report.findings.length > 0) {
      // Use raw findings (check if first element is a group or finding)
      const firstItem = report.findings[0];
      if ('primaryFinding' in firstItem) {
        // It's an array of groups
        (report.findings as any[]).forEach((group: any) => {
          if (group.primaryFinding) {
            allFindings.push(group.primaryFinding);
          }
          if (group.relatedFindings) {
            allFindings.push(...group.relatedFindings.filter(f => f !== undefined));
          }
        });
      } else {
        // It's an array of findings
        allFindings.push(...report.findings);
      }
    }
    
    // Filter out any undefined findings and sort by severity (critical > high > moderate > low)
    const validFindings = allFindings.filter((f): f is Finding => f !== undefined && f !== null && f.severity !== undefined);
    const severityOrder = { critical: 0, high: 1, moderate: 2, low: 3 };
    validFindings.sort((a, b) => {
      const severityDiff = (severityOrder[a.severity as keyof typeof severityOrder] ?? 99) - (severityOrder[b.severity as keyof typeof severityOrder] ?? 99);
      if (severityDiff !== 0) return severityDiff;
      return (b.confidence || 0) - (a.confidence || 0);
    });
    
    let output: string;
    if (args.output === "json") {
      output = JSON.stringify({ report, findings: validFindings, owasp }, null, 2);
    } else if (args.output === "text") {
      output = formatText(report, validFindings);
    } else {
      output = formatSummary(report, validFindings);
    }
    
    console.log(output);
    if (graphOutput) {
      console.log("\n--- Reachability Graph ---\n");
      console.log(graphOutput);
    }
    if (riskyPaths.length > 0 && !args.graphOnly) {
      console.log("\n--- Risky Paths Detected ---\n");
      riskyPaths.slice(0, 10).forEach((path, i) => {
        console.log(`${i + 1}. [${path.riskLevel.toUpperCase()}] Confidence: ${Math.round(path.confidence * 100)}%`);
        console.log(`   Source: ${path.source.label} (${path.source.file}${path.source.line ? `:${path.source.line}` : ""})`);
        if (path.transforms.length > 0) {
          const transforms = path.transforms.map(t => t.label).join(", ");
          console.log(`   Transforms: ${transforms}`);
        }
        console.log(`   Sink: ${path.sink.label} (${path.sink.file}${path.sink.line ? `:${path.sink.line}` : ""})`);
        console.log(`   Path length: ${path.path.length} nodes`);
        console.log("");
      });
      if (riskyPaths.length > 10) {
        console.log(`   ... and ${riskyPaths.length - 10} more risky paths`);
      }
    }
    
    if (redTeamingPlans.length > 0 && !args.graphOnly) {
      console.log("\n--- Red-Teaming Plans ---\n");
      redTeamingPlans.slice(0, 5).forEach((plan, i) => {
        console.log(`${i + 1}. [${plan.riskLevel.toUpperCase()}] ${plan.target.label}`);
        console.log(`   Target: ${plan.target.type} - ${plan.target.file}${plan.target.line ? `:${plan.target.line}` : ""}`);
        console.log(`   Path: ${plan.path.source.label} → ${plan.path.transforms.map(t => t.label).join(" → ")} → ${plan.path.sink.label}`);
        if (plan.risks.length > 0) {
          console.log(`   OWASP Risks: ${plan.risks.map(r => r.owasp).join(", ")}`);
        }
        if (plan.frameworks.length > 0) {
          console.log(`   Frameworks: ${plan.frameworks.join(", ")}`);
        }
        if (plan.attacks.length > 0) {
          console.log(`   Suggested Attacks (${plan.attacks.length}):`);
          plan.attacks.slice(0, 3).forEach(attack => {
            console.log(`     - [${attack.priority.toUpperCase()}] ${attack.title}`);
          });
          if (plan.attacks.length > 3) {
            console.log(`     ... and ${plan.attacks.length - 3} more attacks`);
          }
        }
        console.log("");
      });
      if (redTeamingPlans.length > 5) {
        console.log(`   ... and ${redTeamingPlans.length - 5} more red-teaming plans`);
      }
    }
    
  } catch (error) {
    console.error("\n[ERROR] Scan failed:", (error as Error).message);
    if (verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run if executed directly
main().catch((error) => {
  console.error("[ERROR] Unexpected error:", error);
  process.exit(1);
});

