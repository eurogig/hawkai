import type { Report } from "@/types";
import type { RulePackIndex } from "@/types";

function list(values: string[]): string {
  return values.length ? values.join(", ") : "None";
}

export function reportToMarkdown(report: Report, owasp: RulePackIndex["owasp"]): string {
  const lines: string[] = [];
  lines.push(`# HawkAI Risk Report`);
  lines.push("");
  lines.push(`- Repo: **${report.repo}**`);
  lines.push(`- Branch: **${report.branch}**`);
  lines.push(`- Scanned At: **${report.scannedAt}**`);
  lines.push(`- Files Scanned: **${report.stats.scanned}/${report.stats.files}**`);
  lines.push(`- Duration: **${Math.round(report.stats.durationMs / 1000)}s**`);
  lines.push(`- Overall Score: **${report.score.overall} (${report.score.riskLevel})**`);
  lines.push("");
  lines.push(`## AI Inventory`);
  lines.push(`- SDKs: ${list(report.inventory.sdks)}`);
  lines.push(`- Models: ${list(report.inventory.models)}`);
  lines.push(`- Frameworks: ${list(report.inventory.frameworks)}`);
  lines.push(`- Tools: ${list(report.inventory.tools)}`);
  lines.push("");
  const totalFindings = report.groups?.length ?? report.findings.length;
  lines.push(`## Findings (${totalFindings}${report.groups ? ` grouped from ${report.findings.length} raw findings` : ""})`);

  if (totalFindings === 0) {
    lines.push("No findings detected.");
  } else if (report.groups) {
    // Use grouped findings
    for (const group of report.groups) {
      const finding = group.primaryFinding;
      const severity = group.riskBoost > 0 ? `${group.severity.toUpperCase()} ⚠ (risk boosted)` : group.severity.toUpperCase();
      lines.push(`### [${severity}] ${finding.title}`);
      lines.push(`- Rule: \`${finding.ruleId}\``);
      lines.push(`- Category: ${finding.category}`);
      const fileLocation = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`- File: \`${fileLocation}\``);
      const owaspDescription = finding.owasp
        .map((id) => {
          const meta = owasp[id];
          return meta ? `${id} (${meta.title})` : id;
        })
        .join(", ");
      lines.push(`- OWASP: ${owaspDescription}`);
      lines.push(`- Confidence: ${(finding.confidence * 100).toFixed(0)}%`);
      lines.push(`- Evidence: \`${finding.evidence}\``);
      lines.push(`- Remediation: ${finding.remediation}`);
      
      if (group.relatedFindings.length > 0) {
        lines.push("");
        // Separate same-type usages from hints/metadata
        const sameTypeUsages = group.relatedFindings.filter(r => r.ruleId === finding.ruleId);
        const otherRelated = group.relatedFindings.filter(r => r.ruleId !== finding.ruleId);
        
        if (sameTypeUsages.length > 0) {
          lines.push(`#### Additional ${finding.title} (${sameTypeUsages.length}):`);
          for (const related of sameTypeUsages) {
            const relatedFileLocation = related.line ? `${related.file}:${related.line}` : related.file;
            lines.push(`- \`${relatedFileLocation}\`: \`${related.evidence}\``);
          }
          if (otherRelated.length > 0) {
            lines.push("");
          }
        }
        
        if (otherRelated.length > 0) {
          lines.push(`#### Related Findings (${otherRelated.length}):`);
          for (const related of otherRelated) {
            const relatedFileLocation = related.line ? `${related.file}:${related.line}` : related.file;
            lines.push(`- **${related.title}** (\`${related.ruleId}\`) in \`${relatedFileLocation}\``);
            lines.push(`  - Evidence: \`${related.evidence}\``);
          }
        }
      }
      lines.push("");
    }
  } else {
    // Fallback to individual findings
    for (const finding of report.findings) {
      lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push(`- Rule: \`${finding.ruleId}\``);
      lines.push(`- Category: ${finding.category}`);
      const fileLocation = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`- File: \`${fileLocation}\``);
      const owaspDescription = finding.owasp
        .map((id) => {
          const meta = owasp[id];
          return meta ? `${id} (${meta.title})` : id;
        })
        .join(", ");
      lines.push(`- OWASP: ${owaspDescription}`);
      lines.push(`- Confidence: ${(finding.confidence * 100).toFixed(0)}%`);
      lines.push(`- Evidence: \`${finding.evidence}\``);
      lines.push(`- Remediation: ${finding.remediation}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function exportMarkdown(report: Report, owasp: RulePackIndex["owasp"]): Promise<void> {
  const blob = new Blob([reportToMarkdown(report, owasp)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.repo.replace(/\//g, "-")}-hawkai-report.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportPdf(element: HTMLElement, filename: string): Promise<void> {
  const html2pdf = (await import("html2pdf.js")) as unknown as typeof import("html2pdf.js");
  const worker = html2pdf.default();
  await worker
    .set({
      filename,
      margin: 10,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    })
    .from(element)
    .save();
}
