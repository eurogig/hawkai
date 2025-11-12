import { parseGitHubUrl, repoSlug } from "./url";
import { downloadRepoArchive, resolveDefaultBranch } from "./github";
import { loadRuleIndex, compileRules } from "./rules";
import { createReport, scanArchive } from "./scanner";
import type { ProgressState, Report, ScanContext, RulePackIndex } from "@/types";

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

  emit({ step: "report", message: "Scan complete" });
  return { report, owasp };
}
