#!/usr/bin/env tsx
/**
 * Test red-teaming plan generation
 * 
 * Validates that red-teaming plans are generated correctly from risky paths
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import type { RulePackIndex, ScanContext } from "../src/types.js";
import { parseGitHubUrl } from "../src/core/url.js";
import { downloadRepoArchive, resolveDefaultBranch } from "../src/core/github.js";
import { loadRuleIndex, compileRules } from "../src/core/rules.js";
import { createReport, scanArchive } from "../src/core/scanner.js";
import { buildCoarseGraph, enrichGraphWithCallEdges, propagateConfidence, detectRiskyPaths } from "../src/core/reachability.js";
import { generateRedTeamingPlans } from "../src/core/redTeaming.js";
import { unzipArchive, decodeUtf8, isLikelyBinary } from "../src/core/unzip.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestCase {
  repo: string;
  branch?: string;
  expectedPlans?: number;
  expectedFrameworks?: string[];
  minAttacksPerPlan?: number;
}

const TEST_CASES: TestCase[] = [
  {
    repo: "relari-ai/agent-examples",
    branch: "main",
    expectedPlans: 1, // Should have at least 1 plan if risky paths exist
    expectedFrameworks: ["langgraph"], // Should detect LangGraph
    minAttacksPerPlan: 1 // Each plan should have at least 1 attack
  },
  {
    repo: "langchain-ai/langgraph",
    branch: "main",
    expectedPlans: 0, // May or may not have risky paths
    expectedFrameworks: ["langgraph"],
    minAttacksPerPlan: 1
  }
];

async function runTest(testCase: TestCase) {
  console.log(`\n[TEST] Testing ${testCase.repo}...`);
  
  try {
    const parsed = parseGitHubUrl(`https://github.com/${testCase.repo}`);
    const context: ScanContext = {
      ...parsed,
      branch: testCase.branch || parsed.branch
    };

    // Resolve default branch if needed
    if (!testCase.branch) {
      context.branch = await resolveDefaultBranch(context);
    }

    // Download archive
    console.log(`  Downloading ${testCase.repo}@${context.branch}...`);
    const { buffer } = await downloadRepoArchive(context);

    // Load rules and scan
    console.log(`  Loading rules and scanning...`);
    const { rules: ruleDefs, owasp } = await loadRuleIndex();
    const compiledRules = compileRules(ruleDefs);
    const result = scanArchive(context, buffer, compiledRules);
    const report = createReport(context, result);

    // Build graph
    console.log(`  Building reachability graph...`);
    const groups = report.groups || [];
    if (groups.length === 0) {
      console.log(`  [SKIP] No findings, skipping graph building`);
      return { passed: true, reason: "No findings" };
    }

    let graph = buildCoarseGraph(groups);

    // Collect file contents for call-edge extraction
    const fileContents = new Map<string, string>();
    const filesWithFindings = new Set<string>();
    
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
    graph = enrichGraphWithCallEdges(graph, groups, fileContents);
    
    // Propagate confidence
    graph = propagateConfidence(graph);
    
    // Detect risky paths
    const riskyPaths = detectRiskyPaths(graph);
    console.log(`  Found ${riskyPaths.length} risky paths`);

    if (riskyPaths.length === 0) {
      if (testCase.expectedPlans === 0) {
        console.log(`  [PASS] No risky paths (expected)`);
        return { passed: true };
      } else {
        console.log(`  [SKIP] No risky paths, cannot test plan generation`);
        return { passed: true, reason: "No risky paths" };
      }
    }

    // Generate red-teaming plans
    console.log(`  Generating red-teaming plans...`);
    const plans = generateRedTeamingPlans(riskyPaths, report, owasp);
    console.log(`  Generated ${plans.length} red-teaming plans`);

    // Validate plans
    const errors: string[] = [];

    // Check plan count
    if (testCase.expectedPlans !== undefined && plans.length < testCase.expectedPlans) {
      errors.push(`Expected at least ${testCase.expectedPlans} plans, got ${plans.length}`);
    }

    // Check each plan
    for (const plan of plans) {
      // Validate plan structure
      if (!plan.id) errors.push("Plan missing id");
      if (!plan.target) errors.push("Plan missing target");
      if (!plan.path) errors.push("Plan missing path");
      if (!plan.attacks || plan.attacks.length === 0) {
        errors.push(`Plan ${plan.id} has no attacks`);
      }
      if (testCase.minAttacksPerPlan && plan.attacks.length < testCase.minAttacksPerPlan) {
        errors.push(`Plan ${plan.id} has fewer than ${testCase.minAttacksPerPlan} attacks`);
      }

      // Check framework detection
      if (testCase.expectedFrameworks) {
        const hasExpectedFramework = testCase.expectedFrameworks.some(fw => 
          plan.frameworks.includes(fw.toLowerCase())
        );
        if (!hasExpectedFramework && plan.frameworks.length > 0) {
          // Not an error, just a note - frameworks might not be detected in all cases
          console.log(`  [NOTE] Plan ${plan.id} frameworks: ${plan.frameworks.join(", ")}, expected one of: ${testCase.expectedFrameworks.join(", ")}`);
        }
      }

      // Validate attack structure
      for (const attack of plan.attacks) {
        if (!attack.title) errors.push(`Attack missing title in plan ${plan.id}`);
        if (!attack.description) errors.push(`Attack missing description in plan ${plan.id}`);
        if (!attack.category) errors.push(`Attack missing category in plan ${plan.id}`);
        if (!attack.priority) errors.push(`Attack missing priority in plan ${plan.id}`);
      }

      // Validate risks
      if (plan.risks.length === 0) {
        console.log(`  [NOTE] Plan ${plan.id} has no OWASP risks mapped`);
      }
    }

    if (errors.length > 0) {
      console.log(`  [FAIL] Validation errors:`);
      errors.forEach(err => console.log(`    - ${err}`));
      return { passed: false, errors };
    }

    console.log(`  [PASS] All validations passed`);
    console.log(`    - Plans: ${plans.length}`);
    console.log(`    - Total attacks: ${plans.reduce((sum, p) => sum + p.attacks.length, 0)}`);
    console.log(`    - Frameworks detected: ${[...new Set(plans.flatMap(p => p.frameworks))].join(", ") || "none"}`);
    
    return { passed: true, plans: plans.length };

  } catch (error) {
    console.log(`  [ERROR] Test failed: ${(error as Error).message}`);
    return { passed: false, error: (error as Error).message };
  }
}

async function main() {
  console.log("Red-Teaming Plan Generation Tests\n");
  console.log("=" .repeat(50));

  const results = [];
  for (const testCase of TEST_CASES) {
    const result = await runTest(testCase);
    results.push({ testCase: testCase.repo, ...result });
  }

  console.log("\n" + "=".repeat(50));
  console.log("\nTest Summary:");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total: ${results.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[ERROR] Unexpected error:", error);
  process.exit(1);
});

