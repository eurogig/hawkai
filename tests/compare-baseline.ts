#!/usr/bin/env node
/**
 * Compare scan results against baselines with tolerance.
 *
 * Usage:
 *   npx tsx tests/compare-baseline.ts --high --tolerance 0.15
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { parseGitHubUrl, repoSlug } from "../src/core/url.js";
import { downloadRepoArchive, resolveDefaultBranch } from "../src/core/github.js";
import { compileRules } from "../src/core/rules.js";
import { createReport, scanArchive } from "../src/core/scanner.js";
import type { RuleDefinition, ScanContext } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: any = { high: false, tolerance: 0.15, baseline: "", update: false, updateAll: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--high") flags.high = true;
    if (a === "--tolerance") flags.tolerance = parseFloat(args[++i]);
    if (a === "--baseline") flags.baseline = args[++i];
    if (a === "--update") flags.update = true;
    if (a === "--update-all") flags.updateAll = true;
  }
  return flags;
}

function loadRulesFromFS(): { rules: RuleDefinition[] } {
  const rulesDir = resolve(__dirname, "../public/rules");
  const manifestPath = resolve(rulesDir, "index.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { packs: string[] };
  const rules: RuleDefinition[] = [];
  for (const pack of manifest.packs) {
    const packPath = resolve(rulesDir, pack);
    const content = readFileSync(packPath, "utf-8");
    const packRules = YAML.parse(content) as RuleDefinition[];
    rules.push(...packRules);
  }
  return { rules };
}

function loadCatalog() {
  const catalogPath = resolve(__dirname, "test-repositories.yml");
  return YAML.parse(readFileSync(catalogPath, "utf-8"));
}

async function scanRepo(url: string, compiledRules: ReturnType<typeof compileRules>) {
  const parsed = parseGitHubUrl(url);
  const context: ScanContext = { ...parsed, branch: parsed.branch };
  if (!context.branch) {
    context.branch = await resolveDefaultBranch(context);
  }
  const { buffer } = await downloadRepoArchive(context);
  const result = scanArchive(context, buffer, compiledRules);
  const report = createReport(context, result);
  return { report, totalFindings: result.findings.length };
}

async function main() {
  const args = parseArgs();
  const { rules } = loadRulesFromFS();
  const compiledRules = compileRules(rules);
  const baselinePath = resolve(__dirname, args.baseline || "baselines/high.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as {
    tolerancePct: number; repos: Array<{ name: string; slug: string; expectedFindings: number; }>;
  };
  const tolerance = args.tolerance ?? baseline.tolerancePct ?? 0.15;

  const results: Array<{ name: string; slug: string; expected: number; actual: number; ok: boolean; }> = [];
  let failed = 0;

  for (const base of baseline.repos) {
    const url = `https://github.com/${base.slug}`;
    try {
      const { report, totalFindings } = await scanRepo(url, compiledRules);
      const slug = repoSlug({ owner: report.repo.split("/")[0], repo: report.repo.split("/")[1], branch: report.branch });
      let ok = true;
      let lower = 0;
      let upper = 0;
      if (base.expectedFindings >= 0) {
        lower = Math.floor(base.expectedFindings * (1 - tolerance));
        upper = Math.ceil(base.expectedFindings * (1 + tolerance));
        ok = totalFindings >= lower && totalFindings <= upper;
      }
      console.log(`[BASELINE] ${base.name} (${slug}) expected=${base.expectedFindings} actual=${totalFindings}` +
        (base.expectedFindings >= 0 ? ` range=[${lower}, ${upper}] -> ${ok ? "OK" : "FAIL"}` : " (record-only)"));
      results.push({ name: base.name, slug, expected: base.expectedFindings, actual: totalFindings, ok });
      if (!ok) failed += 1;
    } catch (e: any) {
      // If record-only, tolerate transient repo issues
      if (base.expectedFindings < 0) {
        console.warn(`[BASELINE] ${base.name} (${base.slug}) scan error, skipping record: ${e?.message || e}`);
        results.push({ name: base.name, slug: base.slug, expected: base.expectedFindings, actual: -1, ok: true });
        continue;
      } else {
        console.error(`[BASELINE] ${base.name} (${base.slug}) scan error: ${e?.message || e}`);
        results.push({ name: base.name, slug: base.slug, expected: base.expectedFindings, actual: -1, ok: false });
        failed += 1;
      }
    }
  }

  const summary = {
    tolerance,
    results
  };
  console.log(JSON.stringify(summary, null, 2));

  // Optionally update baseline file:
  if (args.update || args.updateAll) {
    const updated = JSON.parse(readFileSync(baselinePath, "utf-8"));
    for (const r of results) {
      const idx = updated.repos.findIndex((x: any) => x.slug === r.slug);
      if (idx >= 0) {
        const currentExpected = updated.repos[idx].expectedFindings;
        if (args.updateAll || currentExpected < 0) {
          updated.repos[idx].expectedFindings = r.actual;
        }
      }
    }
    writeFileSync(baselinePath, JSON.stringify(updated, null, 2), "utf-8");
    console.log(`[BASELINE] Updated ${baselinePath} with ${args.updateAll ? "all" : "record-only"} actuals.`);
  }

  if (failed > 0) {
    console.error(`[ERROR] ${failed} repositories out of tolerance`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[ERROR]", e);
  process.exit(1);
});


