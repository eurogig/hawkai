import { unzipSync } from "fflate";

const SKIP_DIRECTORIES = [
  "node_modules/",
  "dist/",
  "build/",
  "target/",
  ".git/",
  "venv/",
  "__pycache__/"
];

const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".zip",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".ico"
]);

const textDecoder = new TextDecoder("utf-8", { fatal: false });

export interface FileEntry {
  path: string;
  data: Uint8Array;
}

export interface UnzipOptions {
  maxFiles?: number;
  maxSizeBytes?: number;
}

export function unzipArchive(buffer: Uint8Array, options: UnzipOptions = {}): FileEntry[] {
  const { maxFiles = 30000, maxSizeBytes = 100 * 1024 * 1024 } = options;
  const files = unzipSync(buffer, { filter: fileFilter });

  const entries: FileEntry[] = [];
  let totalSize = 0;

  for (const path of Object.keys(files)) {
    if (shouldSkip(path)) continue;
    const data = files[path];
    if (!data) continue;

    totalSize += data.length;
    if (entries.length >= maxFiles) {
      break;
    }
    if (totalSize > maxSizeBytes) {
      break;
    }

    entries.push({ path: normalizePath(path), data });
  }

  return entries;
}

function fileFilter(file: { name: string; originalSize: number }): boolean {
  if (shouldSkip(file.name)) {
    return false;
  }
  if (file.originalSize > 5 * 1024 * 1024) {
    // skip extremely large files individually
    return false;
  }
  return true;
}

function normalizePath(path: string): string {
  return path.replace(/^([^/]+)\//, "");
}

export function shouldSkip(path: string): boolean {
  const lower = path.toLowerCase();
  if (SKIP_DIRECTORIES.some((dir) => lower.includes(dir))) {
    return true;
  }
  const ext = lower.slice(lower.lastIndexOf("."));
  if (SKIP_EXTENSIONS.has(ext)) {
    return true;
  }
  return false;
}

export function decodeUtf8(data: Uint8Array): string {
  return textDecoder.decode(data);
}

export function isLikelyBinary(data: Uint8Array): boolean {
  const length = data.length;
  if (length === 0) return false;
  let suspicious = 0;
  const max = Math.min(length, 1024);
  for (let i = 0; i < max; i += 1) {
    const value = data[i];
    if (value === 0) return true;
    if (value < 7 || value > 127) {
      suspicious += 1;
    }
  }
  return suspicious / max > 0.3;
}
