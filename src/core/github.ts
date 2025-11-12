import { buildArchiveUrl } from "./url";
import type { ScanContext } from "@/types";

export async function resolveDefaultBranch(context: ScanContext, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(`https://api.github.com/repos/${context.owner}/${context.repo}`, {
      headers: {
        Accept: "application/vnd.github+json"
      },
      signal
    });

    if (!response.ok) {
      throw new Error(`Failed to resolve default branch (${response.status})`);
    }

    const data = (await response.json()) as { default_branch?: string };
    return data.default_branch ?? context.branch;
  } catch (error) {
    console.warn("Failed to resolve default branch, falling back to provided branch", error);
    return context.branch;
  }
}

export interface DownloadOptions {
  onProgress?: (receivedBytes: number, totalBytes?: number) => void;
  signal?: AbortSignal;
}

export interface DownloadResult {
  branch: string;
  buffer: Uint8Array;
}

/**
 * Proxies a URL through a CORS proxy service
 * Note: For production, consider using your own proxy or GitHub API with authentication
 */
function proxyUrl(url: string): string {
  // Using corsproxy.io as a free CORS proxy (for MVP)
  // In production, you might want to use your own proxy or GitHub API with auth
  return `https://corsproxy.io/?${encodeURIComponent(url)}`;
}

async function readAsUint8Array(response: Response, onProgress?: DownloadOptions["onProgress"]): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress?.(buffer.byteLength, buffer.byteLength);
    return buffer;
  }

  const contentLength = Number(response.headers.get("Content-Length") ?? "0");
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress?.(received, contentLength > 0 ? contentLength : undefined);
    }
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress?.(received, contentLength > 0 ? contentLength : undefined);
  return buffer;
}

async function tryFetch(url: string, options: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, options);
    // If we get a response (even if not ok), return it
    return response;
  } catch (error) {
    // If it's a CORS/network error (TypeError: Failed to fetch), try with proxy
    const err = error as Error;
    if (err.name === "TypeError" && (err.message.includes("Failed to fetch") || err.message.includes("fetch"))) {
      console.log("Direct fetch failed, trying CORS proxy...");
      const proxiedUrl = proxyUrl(url);
      return await fetch(proxiedUrl, options);
    }
    throw error;
  }
}

export async function downloadRepoArchive(
  context: ScanContext,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const { onProgress, signal } = options;
  // Try multiple branch candidates: provided branch, main, master
  const branchCandidates = [
    context.branch,
    context.branch !== "main" ? "main" : undefined,
    context.branch !== "master" ? "master" : undefined
  ].filter((value, index, self) => value && self.indexOf(value) === index) as string[];

  const errors: string[] = [];

  for (const branch of branchCandidates) {
    const url = buildArchiveUrl({ ...context, branch });
    try {
      // tryFetch will automatically use CORS proxy if direct fetch fails
      const response = await tryFetch(url, {
        cache: "no-store",
        signal
      });

      if (!response.ok) {
        const errorText = response.status === 404 
          ? `Branch '${branch}' not found (404)`
          : `HTTP ${response.status}: ${response.statusText}`;
        errors.push(`${branch}: ${errorText}`);
        if (response.status === 404) {
          continue;
        }
        // For non-404 errors, log but continue trying other branches
        console.warn(`Failed to download ${branch}:`, errorText);
        continue;
      }

      const buffer = await readAsUint8Array(response, onProgress);
      return { branch, buffer };
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw error;
      }
      const errorMsg = (error as Error).message ?? "Unknown error";
      errors.push(`${branch}: ${errorMsg}`);
      console.warn(`Failed to download branch ${branch}`, error);
    }
  }

  const errorDetails = errors.length > 0 ? `\nTried: ${errors.join("; ")}` : "";
  throw new Error(`Unable to download repository archive. Check the URL and branch.${errorDetails}`);
}
