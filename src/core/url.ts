import type { ScanContext } from "@/types";

const GITHUB_URL_REGEX = /github\.com\/(.*?)\/(.*?)(?:\/(tree|blob)\/(.*?))?(?:$|\s|#)/i;

export function parseGitHubUrl(input: string): ScanContext {
  const trimmed = input.trim();
  const match = trimmed.match(GITHUB_URL_REGEX);
  if (!match) {
    throw new Error("Invalid GitHub URL. Expected format https://github.com/owner/repo");
  }

  const [, owner, repo, type, branch] = match;
  const cleanRepo = repo.replace(/\.git$/, "");

  return {
    owner,
    repo: cleanRepo,
    branch: type === "tree" && branch ? branch : branch ?? "main"
  };
}

export function buildArchiveUrl({ owner, repo, branch }: ScanContext): string {
  // GitHub codeload supports both formats:
  // - /zip/refs/heads/{branch} (explicit ref format)
  // - /zip/{branch} (simpler format, also works)
  // We'll use the simpler format first as it's more commonly used
  return `https://codeload.github.com/${owner}/${repo}/zip/${branch}`;
}

export function repoSlug({ owner, repo }: ScanContext): string {
  return `${owner}/${repo}`;
}
