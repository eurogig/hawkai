import { forwardRef, useEffect, useMemo, useState } from "react";
import type { Report } from "@/types";
import type { RulePackIndex } from "@/types";
import InventoryGrid from "./Inventory";
import FindingsTable from "./FindingsTable";
import RiskScoreBadge from "./RiskScore";
import ReachabilityGraphView from "./ReachabilityGraph";

interface ReportProps {
  report: Report;
  owasp: RulePackIndex["owasp"];
  onExportMarkdown: () => void;
  onExportPdf: () => void;
}

const ReportView = forwardRef<HTMLDivElement, ReportProps>(function ReportView(
  { report, owasp, onExportMarkdown, onExportPdf },
  ref
) {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showGraph, setShowGraph] = useState(false);

  // Trigger highlight animation when report first appears
  useEffect(() => {
    if (ref && typeof ref === "object" && ref.current) {
      // Small delay to ensure element is rendered
      const timer = setTimeout(() => {
        if (ref.current) {
          ref.current.classList.add("report-ready-highlight");
          setTimeout(() => {
            ref.current?.classList.remove("report-ready-highlight");
          }, 2000);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [report.repo, ref]); // Trigger when report changes

  const severityCounts = useMemo(() => {
    // Use groups if available, otherwise use findings
    const items = report.groups ?? report.findings;
    return items.reduce<Record<string, number>>((acc, item) => {
      const severity = "primaryFinding" in item ? item.severity : item.severity;
      acc[severity] = (acc[severity] ?? 0) + 1;
      return acc;
    }, {});
  }, [report.groups, report.findings]);
  
  const totalCount = useMemo(() => {
    return report.groups?.length ?? report.findings.length;
  }, [report.groups, report.findings]);

  return (
    <section
      ref={ref}
      className="flex flex-col gap-8 border-2 border-steampunk-brass bg-grey-iron p-8 shadow-lg font-mono"
    >
      <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-terminal-green-bright uppercase tracking-wider">
            <span className="text-steampunk-brass">[</span>RISK REPORT<span className="text-steampunk-brass">]</span>
          </h2>
          <p className="mt-2 text-sm text-grey-ash font-mono">
            <span className="text-steampunk-brass">&gt;</span> {report.repo} <span className="text-steampunk-brass">|</span> Branch: {report.branch} <span className="text-steampunk-brass">|</span> {new Date(report.scannedAt).toLocaleString()}
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-grey-ash">
            <span className="border-2 border-steampunk-brass bg-grey-charcoal px-3 py-1 font-bold">
              <span className="text-steampunk-brass">[</span>FILES<span className="text-steampunk-brass">]</span> {report.stats.scanned}/{report.stats.files}
            </span>
            <span className="border-2 border-steampunk-brass bg-grey-charcoal px-3 py-1 font-bold">
              <span className="text-steampunk-brass">[</span>DURATION<span className="text-steampunk-brass">]</span> {Math.round(report.stats.durationMs / 1000)}s
            </span>
            <span className="border-2 border-steampunk-brass bg-grey-charcoal px-3 py-1 font-bold">
              <span className="text-steampunk-brass">[</span>FINDINGS<span className="text-steampunk-brass">]</span> {totalCount} {report.groups ? `(grouped from ${report.findings.length})` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <RiskScoreBadge score={report.score} />
          <div className="flex gap-3">
            {report.graph && (
              <button
                onClick={() => setShowGraph(true)}
                className="border-2 border-steampunk-brass px-4 py-2 text-xs font-bold text-steampunk-brass uppercase transition hover:border-steampunk-brass-bright hover:text-steampunk-brass-bright hover:shadow-lg font-mono"
              >
                [VIEW GRAPH]
                {report.riskyPaths && report.riskyPaths.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-red-900 text-red-200 text-xs">
                    {report.riskyPaths.length}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={onExportMarkdown}
              className="border-2 border-steampunk-brass px-4 py-2 text-xs font-bold text-steampunk-brass uppercase transition hover:border-steampunk-brass-bright hover:text-steampunk-brass-bright hover:shadow-lg font-mono"
            >
              [EXPORT MD]
            </button>
            <button
              onClick={onExportPdf}
              className="border-2 border-steampunk-brass bg-terminal-green px-4 py-2 text-xs font-bold text-grey-charcoal uppercase transition hover:bg-terminal-green-bright hover:border-steampunk-brass-bright hover:shadow-terminal-glow font-mono"
            >
              [EXPORT PDF]
            </button>
          </div>
        </div>
      </header>

      <InventoryGrid inventory={report.inventory} />

      <div className="flex flex-col gap-4 border-2 border-steampunk-brass bg-grey-charcoal p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-lg font-bold text-terminal-green-bright uppercase tracking-wider">
            <span className="text-steampunk-brass">[</span>FINDINGS<span className="text-steampunk-brass">]</span>
          </h3>
          <div className="flex flex-wrap gap-3 text-xs font-mono">
            {(["critical", "high", "moderate", "low"] as const).map((severity) => (
              <button
                key={severity}
                onClick={() => setSeverityFilter((prev) => (prev === severity ? "all" : severity))}
                className={`border-2 px-4 py-2 font-bold uppercase transition ${
                  severityFilter === severity
                    ? `border-severity-${severity} bg-grey-charcoal text-severity-${severity} shadow-terminal-glow`
                    : "border-grey-slate text-grey-ash hover:border-steampunk-brass hover:text-steampunk-brass"
                }`}
              >
                {severity.toUpperCase()} ({severityCounts[severity] ?? 0})
              </button>
            ))}
            <button
              onClick={() => setSeverityFilter("all")}
              className={`border-2 px-4 py-2 font-bold uppercase transition ${
                severityFilter === "all"
                  ? "border-steampunk-brass-bright bg-grey-charcoal text-terminal-green-bright shadow-terminal-glow"
                  : "border-grey-slate text-grey-ash hover:border-steampunk-brass hover:text-steampunk-brass"
              }`}
            >
              ALL ({totalCount})
            </button>
          </div>
        </div>
        <input
          type="search"
          placeholder="> Search findings by file, rule, or evidence"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="border-2 border-steampunk-brass bg-grey-iron px-4 py-3 text-sm text-terminal-green placeholder:text-grey-ash focus:border-steampunk-brass-bright focus:outline-none focus:ring-2 focus:ring-steampunk-brass font-mono"
        />
        <FindingsTable
          findings={report.findings}
          groups={report.groups}
          filterSeverity={severityFilter}
          searchQuery={searchQuery}
          owasp={owasp}
        />
      </div>

      {/* Reachability Graph Overlay */}
      {showGraph && report.graph && (
        <ReachabilityGraphView
          graph={report.graph}
          riskyPaths={report.riskyPaths || []}
          onClose={() => setShowGraph(false)}
        />
      )}
    </section>
  );
});

export default ReportView;
