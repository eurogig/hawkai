import clsx from "clsx";
import { useState } from "react";
import type { ProgressState, Report } from "@/types";
import RiskScoreBadge from "./RiskScore";

interface ProgressProps {
  progress: ProgressState;
  isScanning: boolean;
  error: string | null;
  report: Report | null;
  onViewReport: () => void;
}

const STEPS: Array<{ id: ProgressState["step"]; label: string }> = [
  { id: "parsing", label: "Parse URL" },
  { id: "resolving", label: "Resolve Branch" },
  { id: "downloading", label: "Download" },
  { id: "unzipping", label: "Unzip" },
  { id: "scanning", label: "Scan" },
  { id: "report", label: "Report" }
];

function ProgressPanel({ progress, isScanning, error, report, onViewReport }: ProgressProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const activeIndex = STEPS.findIndex((step) => step.id === progress.step);
  const isComplete = report !== null && !isScanning && !error;

  return (
    <section className={clsx(
      "border-2 border-steampunk-brass bg-grey-iron text-sm text-terminal-green font-mono transition-all",
      isComplete && "shadow-terminal-glow"
    )}>
      <div className="flex items-center justify-between p-6 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider font-bold">
          <span className="border-2 border-steampunk-brass px-3 py-1 bg-grey-charcoal text-steampunk-brass-bright">
            <span className="text-steampunk-copper-bright">[</span>
            {isComplete ? "SCAN COMPLETE" : "SCAN PROGRESS"}
            <span className="text-steampunk-copper-bright">]</span>
          </span>
          {isScanning && progress.step === "downloading" && typeof (progress as any).progress === "number" ? (
            <span className="text-terminal-cyan-bright">{Math.round(((progress as any).progress ?? 0) * 100)}%</span>
          ) : null}
        </div>
        {isComplete && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-steampunk-brass hover:text-steampunk-brass-bright font-bold uppercase text-xs"
          >
            {isCollapsed ? "[+]" : "[−]"}
          </button>
        )}
      </div>

      {!isCollapsed && (
        <div className="flex flex-col gap-4 px-6 pb-6">
          <ol className="flex flex-wrap gap-4 text-xs">
            {STEPS.map((step, index) => (
              <li
                key={step.id}
                className={clsx(
                  "flex items-center gap-2 border-2 px-4 py-2 font-bold uppercase",
                  index < activeIndex ? "border-steampunk-brass-bright text-terminal-green-bright bg-grey-charcoal" : "border-grey-slate text-grey-ash",
                  index === activeIndex ? "border-steampunk-brass-bright text-terminal-green-bright bg-grey-charcoal shadow-terminal-glow" : ""
                )}
              >
                <span className="inline-flex h-6 w-6 items-center justify-center border-2 border-steampunk-brass bg-grey-charcoal text-xs font-bold text-steampunk-brass">
                  {index < activeIndex ? "✓" : index + 1}
                </span>
                {step.label}
              </li>
            ))}
          </ol>

          <div className="border-2 border-steampunk-brass bg-grey-charcoal p-4">
            {error ? (
              <p className="text-sm text-severity-critical font-bold"><span className="text-steampunk-brass">[ERROR]</span> {error}</p>
            ) : isComplete && report ? (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-sm text-terminal-green-bright font-bold mb-3">
                    <span className="text-steampunk-brass">[</span>REPORT READY<span className="text-steampunk-brass">]</span>
                  </p>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <RiskScoreBadge score={report.score} />
                    <button
                      onClick={onViewReport}
                      className="border-2 border-steampunk-brass bg-terminal-green px-6 py-3 text-sm font-bold text-grey-charcoal uppercase transition hover:bg-terminal-green-bright hover:border-steampunk-brass-bright hover:shadow-terminal-glow font-mono"
                    >
                      [VIEW REPORT]
                    </button>
                  </div>
                </div>
                <div className="text-xs text-grey-ash">
                  <span className="text-steampunk-brass">//</span> {report.findings.length} findings detected · {report.groups?.length ?? report.findings.length} grouped
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-terminal-green-bright font-bold"><span className="text-steampunk-brass">&gt;</span> {progress.message}</p>
                {progress.step === "scanning" && "currentFile" in progress && progress.currentFile ? (
                  <p className="mt-1 text-xs text-grey-ash">
                    <span className="text-steampunk-brass">//</span> Processing {progress.currentFile}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default ProgressPanel;
