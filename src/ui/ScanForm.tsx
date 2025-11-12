import { useState } from "react";
import type { ProgressState } from "@/types";

export interface ScanFormValues {
  url: string;
  branch?: string;
}

interface ScanFormProps {
  isScanning: boolean;
  onSubmit: (values: ScanFormValues) => void;
  onCancel: () => void;
  progress: ProgressState;
}

function ScanForm({ isScanning, onSubmit, onCancel, progress }: ScanFormProps) {
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    onSubmit({ url: url.trim(), branch: branch.trim() || undefined });
  };

  return (
    <section className="border-2 border-steampunk-brass bg-grey-iron p-6 shadow-lg font-mono">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-describedby="scan-help">
        <div>
          <label htmlFor="repo-url" className="text-sm font-bold text-terminal-green-bright uppercase">
            <span className="text-steampunk-brass">&gt;</span> GitHub repository URL
          </label>
          <input
            id="repo-url"
            type="url"
            required
            autoComplete="off"
            placeholder="https://github.com/owner/repo"
            className="mt-2 w-full border-2 border-steampunk-brass bg-grey-charcoal px-4 py-3 text-sm text-terminal-green placeholder:text-grey-ash focus:border-steampunk-brass-bright focus:outline-none focus:ring-2 focus:ring-steampunk-brass font-mono"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[240px_auto]">
          <div>
            <label htmlFor="branch" className="text-sm font-bold text-terminal-green-bright uppercase">
              <span className="text-steampunk-brass">&gt;</span> Branch (optional)
            </label>
            <input
              id="branch"
              type="text"
              placeholder="main"
              className="mt-2 w-full border-2 border-steampunk-brass bg-grey-charcoal px-4 py-3 text-sm text-terminal-green placeholder:text-grey-ash focus:border-steampunk-brass-bright focus:outline-none focus:ring-2 focus:ring-steampunk-brass font-mono"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3 sm:items-end sm:justify-end">
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={isScanning}
                className="inline-flex items-center justify-center border-2 border-steampunk-brass bg-terminal-green px-6 py-3 text-sm font-bold text-grey-charcoal uppercase transition hover:bg-terminal-green-bright hover:border-steampunk-brass-bright hover:shadow-terminal-glow disabled:cursor-not-allowed disabled:border-grey-slate disabled:bg-grey-iron disabled:text-grey-ash font-mono"
              >
                {isScanning ? "[SCANNING...]" : "[SCAN]"}
              </button>
              <button
                type="button"
                disabled={!isScanning}
                onClick={onCancel}
                className="inline-flex items-center justify-center border-2 border-steampunk-brass px-6 py-3 text-sm font-bold text-steampunk-brass uppercase transition hover:border-steampunk-brass-bright hover:text-steampunk-brass-bright disabled:cursor-not-allowed disabled:border-grey-slate disabled:text-grey-ash font-mono"
              >
                [CANCEL]
              </button>
            </div>
          </div>
        </div>

        <div className="border-2 border-steampunk-brass bg-grey-charcoal p-4 text-xs text-grey-ash font-mono" aria-live="polite">
          <p className="font-bold text-terminal-green-bright uppercase"><span className="text-steampunk-brass">[</span>STATUS<span className="text-steampunk-brass">]</span></p>
          <p className="mt-1"><span className="text-steampunk-brass">&gt;</span> {progress.message}</p>
        </div>
      </form>
    </section>
  );
}

export default ScanForm;
