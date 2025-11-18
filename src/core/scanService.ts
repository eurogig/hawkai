import { parseGitHubUrl, repoSlug } from "./url";
import { downloadRepoArchive, resolveDefaultBranch } from "./github";
import { loadRuleIndex, compileRules } from "./rules";
import { createReport, scanArchive } from "./scanner";
import type { ProgressState, Report, ScanContext, RulePackIndex } from "@/types";
import { setScoringConfig } from "./scoring";
import { buildCoarseGraph, enrichGraphWithCallEdges, propagateConfidence, detectRiskyPaths } from "./reachability";
import { unzipArchive, decodeUtf8, isLikelyBinary } from "./unzip";
import { generateRedTeamingPlans } from "./redTeaming";

export interface ScanCallbacks {
  onState?: (state: ProgressState) => void;
}

export interface ScanParams {
  url: string;
  branch?: string;
  signal?: AbortSignal;
}

export interface ScanOutcome {
  report: Report;
  owasp: RulePackIndex["owasp"];
}

export async function performScan(
  { url, branch, signal }: ScanParams,
  callbacks: ScanCallbacks = {}
): Promise<ScanOutcome> {
  const { onState } = callbacks;
  const emit = onState ?? (() => {});

  const jobStart = performance.now();

  emit({ step: "parsing", message: "Parsing repository URL" });

  const parsed = parseGitHubUrl(url);
  const context: ScanContext = {
    ...parsed,
    branch: branch ?? parsed.branch
  };

  // Only resolve default branch if no explicit branch was provided
  if (!branch) {
    emit({ step: "resolving", message: "Resolving default branch" });
    const resolvedBranch = await resolveDefaultBranch(context, signal);
    context.branch = resolvedBranch;
  }

  emit({ step: "downloading", message: `Downloading ${repoSlug(context)}@${context.branch}` });
  const { buffer, branch: downloadedBranch } = await downloadRepoArchive(context, {
    signal,
    onProgress(received, total) {
      emit({
        step: "downloading",
        message: `Downloading ${repoSlug(context)}@${context.branch}`,
        progress: total ? Math.min(1, received / total) : undefined
      });
    }
  });
  context.branch = downloadedBranch;

  emit({ step: "unzipping", message: "Unpacking archive" });

  emit({ step: "scanning", message: "Loading rule packs" });
  const { rules: ruleDefs, owasp } = await loadRuleIndex(signal);
  const compiledRules = compileRules(ruleDefs);

  // Try to load scoring config at runtime (optional)
  try {
    const baseUrl = import.meta.env.BASE_URL;
    const cfgUrl = `${baseUrl}config/scoring.json`.replace(/\/+/g, "/");
    const resp = await fetch(cfgUrl, { cache: "no-store", signal });
    if (resp.ok) {
      const cfg = await resp.json();
      setScoringConfig(cfg);
    }
  } catch {
    // ignore; fall back to defaults
  }

  const result = scanArchive(context, buffer, compiledRules, {
    onProgress({ currentFile, scanned, total }) {
      emit({
        step: "scanning",
        message: `Scanning files (${scanned}/${total})`,
        currentFile,
        scanned,
        total
      });
    }
  });

  result.stats.durationMs = Math.round(performance.now() - jobStart);

  const report = createReport(context, result);

  // Phase 3: Build reachability graph during scan
  emit({ step: "report", message: "Building reachability graph" });
  try {
    const groups = report.groups || [];
    if (groups.length > 0) {
      // Build coarse graph
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
      
      // Add to report
      report.graph = graph;
      report.riskyPaths = riskyPaths;

      // Phase 4: Generate red-teaming plans from risky paths
      try {
        emit({ step: "report", message: "Generating red-teaming plans" });
        const redTeamingPlans = generateRedTeamingPlans(riskyPaths, report, owasp);
        report.redTeamingPlans = redTeamingPlans;
      } catch (error) {
        // Don't fail the scan if plan generation fails
        console.warn("Failed to generate red-teaming plans:", error);
      }
    }
  } catch (error) {
    // Don't fail the scan if graph building fails
    console.warn("Failed to build reachability graph:", error);
  }

  emit({ step: "report", message: "Scan complete" });
  return { report, owasp };
}
