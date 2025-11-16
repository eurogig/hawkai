#!/usr/bin/env node
/**
 * Test Runner for HawkAI Repository Catalog
 * 
 * Runs scans against repositories in test-repositories.yml to validate
 * detection rules are working correctly.
 * 
 * Usage:
 *   npm run test:repos                    # Test all repositories
 *   npm run test:repos -- --high          # Test only high priority repos
 *   npm run test:repos -- --framework langgraph  # Test specific framework
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { parseGitHubUrl } from "../src/core/url.js";
import { downloadRepoArchive, resolveDefaultBranch } from "../src/core/github.js";
import { compileRules } from "../src/core/rules.js";
import { createReport, scanArchive } from "../src/core/scanner.js";
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

interface TestRepository {
  name: string;
  url: string;
  branch?: string;
  description: string;
  frameworks: string[];
  languages: string[];
  test_categories: string[];
  notes: string;
}

interface TestCatalog {
  repositories: TestRepository[];
  metadata: {
    version: string;
    last_updated: string;
    total_repositories: number;
    test_priorities?: {
      high?: string[];
      medium?: string[];
      low?: string[];
    };
  };
}

function parseArgs(): { 
  high?: boolean; 
  framework?: string; 
  limit?: number;
  verbose?: boolean;
} {
  const args = process.argv.slice(2);
  const parsed: any = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--high" || arg === "-h") {
      parsed.high = true;
    } else if (arg === "--framework" || arg === "-f") {
      parsed.framework = args[++i];
    } else if (arg === "--limit" || arg === "-l") {
      parsed.limit = parseInt(args[++i], 10);
    } else if (arg === "--verbose" || arg === "-v") {
      parsed.verbose = true;
    }
  }
  
  return parsed;
}

function loadCatalog(): TestCatalog {
  const catalogPath = resolve(__dirname, "test-repositories.yml");
  if (!existsSync(catalogPath)) {
    throw new Error(`Catalog file not found: ${catalogPath}`);
  }
  
  const content = readFileSync(catalogPath, "utf-8");
  return YAML.parse(content) as TestCatalog;
}

async function scanRepository(
  repo: TestRepository,
  compiledRules: any[],
  verbose = false
): Promise<{ success: boolean; findings: number; error?: string; duration?: number }> {
  try {
    if (verbose) {
      console.log(`\n[INFO] Testing: ${repo.name}`);
      console.log(`[INFO] URL: ${repo.url}`);
    }
    
    const parsed = parseGitHubUrl(repo.url);
    const context: ScanContext = {
      ...parsed,
      branch: repo.branch ?? "main"
    };
    
    if (!repo.branch) {
      context.branch = await resolveDefaultBranch(context);
    }
    
    const startTime = Date.now();
    const { buffer } = await downloadRepoArchive(context);
    
    const result = scanArchive(context, buffer, compiledRules);
    result.stats.durationMs = Date.now() - startTime;
    const report = createReport(context, result);
    
    return {
      success: true,
      findings: result.findings.length,
      duration: result.stats.durationMs
    };
  } catch (error) {
    return {
      success: false,
      findings: 0,
      error: (error as Error).message
    };
  }
}

async function main() {
  const args = parseArgs();
  
  console.log("HawkAI Repository Test Runner");
  console.log("==============================\n");
  
  const catalog = loadCatalog();
  console.log(`Loaded catalog with ${catalog.repositories.length} repositories\n`);
  
  // Load rules once
  const { rules } = await loadRulesFromFS();
  const compiledRules = compileRules(rules);
  console.log(`Loaded ${compiledRules.length} rules\n`);
  
  // Filter repositories
  let reposToTest = catalog.repositories;
  
  if (args.high && catalog.metadata.test_priorities?.high) {
    const highPriorityNames = catalog.metadata.test_priorities.high;
    reposToTest = reposToTest.filter(r => 
      highPriorityNames.some(name => r.url.includes(name.split('/').pop() || ''))
    );
    console.log(`Filtering to high priority repositories: ${reposToTest.length}\n`);
  }
  
  if (args.framework) {
    reposToTest = reposToTest.filter(r => 
      r.frameworks.some(f => f.toLowerCase().includes(args.framework!.toLowerCase()))
    );
    console.log(`Filtering to ${args.framework} frameworks: ${reposToTest.length}\n`);
  }
  
  if (args.limit) {
    reposToTest = reposToTest.slice(0, args.limit);
    console.log(`Limiting to first ${args.limit} repositories\n`);
  }
  
  console.log(`Testing ${reposToTest.length} repositories...\n`);
  
  const results: Array<{
    repo: TestRepository;
    success: boolean;
    findings: number;
    error?: string;
    duration?: number;
  }> = [];
  
  for (const repo of reposToTest) {
    const result = await scanRepository(repo, compiledRules, args.verbose);
    results.push({ repo, ...result });
    
    const status = result.success 
      ? `✓ ${result.findings} findings (${result.duration}ms)`
      : `✗ ERROR: ${result.error}`;
    
    console.log(`${repo.name.padEnd(40)} ${status}`);
  }
  
  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("Test Summary");
  console.log("=".repeat(80));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalFindings = results.reduce((sum, r) => sum + r.findings, 0);
  const avgFindings = successful > 0 ? (totalFindings / successful).toFixed(1) : 0;
  
  console.log(`Total Repositories: ${results.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Findings: ${totalFindings}`);
  console.log(`Average Findings per Repo: ${avgFindings}`);
  
  if (failed > 0) {
    console.log("\nFailed Repositories:");
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.repo.name}: ${r.error}`);
    });
  }
  
  console.log("\n" + "=".repeat(80));
}

main().catch(error => {
  console.error("[ERROR]", error);
  process.exit(1);
});

