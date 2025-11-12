import { useCallback, useMemo, useRef, useState } from "react";
import type { ProgressState, Report } from "@/types";
import type { RulePackIndex } from "@/types";
import { performScan } from "@/core/scanService";
import { exportMarkdown, exportPdf } from "@/lib/reportExport";
import ScanForm, { type ScanFormValues } from "./ScanForm";
import ProgressPanel from "./Progress";
import ReportView from "./Report";

const INITIAL_PROGRESS: ProgressState = { step: "idle", message: "Awaiting scan" };

function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(INITIAL_PROGRESS);
  const [report, setReport] = useState<Report | null>(null);
  const [owasp, setOwasp] = useState<RulePackIndex["owasp"]>({});
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reportRef = useRef<HTMLDivElement | null>(null);

  const handleScan = useCallback(async (values: ScanFormValues) => {
    if (isScanning) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsScanning(true);
    setProgress({ step: "parsing", message: "Parsing repository URL" });
    setError(null);

    try {
      const outcome = await performScan(
        { url: values.url, branch: values.branch || undefined, signal: controller.signal },
        {
          onState(state) {
            setProgress(state);
          }
        }
      );

      setReport(outcome.report);
      setOwasp(outcome.owasp);
    } catch (scanError) {
      if ((scanError as Error).name === "AbortError") {
        setError("Scan cancelled");
      } else {
        console.error(scanError);
        setError((scanError as Error).message ?? "Scan failed");
      }
    } finally {
      setIsScanning(false);
      setProgress({ step: "idle", message: "Ready" });
      abortRef.current = null;
    }
  }, [isScanning]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  const handleExportMarkdown = useCallback(async () => {
    if (report) {
      await exportMarkdown(report, owasp);
    }
  }, [report, owasp]);

  const handleExportPdf = useCallback(async () => {
    if (report && reportRef.current) {
      await exportPdf(reportRef.current, `${report.repo.replace(/\//g, "-")}-hawkai-report.pdf`);
    }
  }, [report]);

  const handleViewReport = useCallback(() => {
    if (reportRef.current) {
      reportRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      // Add a temporary highlight class
      reportRef.current.classList.add("report-ready-highlight");
      setTimeout(() => {
        reportRef.current?.classList.remove("report-ready-highlight");
      }, 2000);
    }
  }, []);

  const hasReport = useMemo(() => report != null, [report]);

  return (
    <div className="min-h-screen bg-grey-charcoal text-terminal-green font-terminal">
      <header className="border-b-2 border-steampunk-brass bg-grey-steel backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 border-2 border-steampunk-brass bg-steampunk-dark-wood flex items-center justify-center shadow-lg">
                <span className="text-steampunk-brass-bright text-2xl font-bold">H</span>
              </div>
              <h1 className="text-3xl font-bold tracking-wider text-terminal-green-bright uppercase">
                <span className="text-steampunk-brass">[</span>HawkAI<span className="text-steampunk-brass">]</span> <span className="text-steampunk-copper-bright">SCAN</span>
              </h1>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-grey-ash font-mono">
              <span className="text-steampunk-brass">&gt;</span> Paste a public GitHub repository URL to generate an AI risk report.<br/>
              <span className="text-steampunk-brass">&gt;</span> All analysis runs client-side. Your repository never uploads to a server.<br/>            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <ScanForm
          onSubmit={handleScan}
          onCancel={handleCancel}
          isScanning={isScanning}
          progress={progress}
        />

        <ProgressPanel 
          progress={progress} 
          isScanning={isScanning} 
          error={error}
          report={report}
          onViewReport={handleViewReport}
        />

        {hasReport ? (
          <ReportView
            ref={reportRef}
            report={report!}
            owasp={owasp}
            onExportMarkdown={handleExportMarkdown}
            onExportPdf={handleExportPdf}
          />
        ) : (
          <section className="border-2 border-steampunk-brass border-dashed bg-grey-iron p-10 text-center text-sm text-grey-ash font-mono">
            <p><span className="text-steampunk-brass">&gt;</span> Paste a GitHub URL to begin. Example: https://github.com/vercel/next.js</p>
          </section>
        )}
      </main>

      <footer className="border-t-2 border-steampunk-brass bg-grey-steel py-6 text-center text-xs text-grey-ash font-mono">
        <span className="text-steampunk-brass">[</span>HawkAI<span className="text-steampunk-brass">]</span> — See the unseen. OWASP LLM Top 10 aligned insights.
      </footer>
    </div>
  );
}

export default App;
