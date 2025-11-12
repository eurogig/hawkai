import React, { useMemo, useState } from "react";
import type { Finding, FindingGroup } from "@/types";
import type { RulePackIndex } from "@/types";

interface FindingsTableProps {
  findings: Finding[];
  groups?: FindingGroup[];
  filterSeverity: string;
  searchQuery: string;
  owasp: RulePackIndex["owasp"];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-2 border-severity-critical bg-grey-charcoal text-severity-critical font-bold",
  high: "border-2 border-severity-high bg-grey-charcoal text-severity-high font-bold",
  moderate: "border-2 border-severity-moderate bg-grey-charcoal text-severity-moderate font-bold",
  low: "border-2 border-severity-low bg-grey-charcoal text-severity-low font-bold"
};

function FindingsTable({ findings, groups, filterSeverity, searchQuery, owasp }: FindingsTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items: FindingGroup[] = groups ?? findings.map(f => ({
      id: f.id,
      primaryFinding: f,
      relatedFindings: [],
      severity: f.severity,
      file: f.file,
      category: f.category,
      riskBoost: 0
    }));
    
    return items.filter((item) => {
      if (filterSeverity !== "all" && item.severity !== filterSeverity) {
        return false;
      }
      if (!query) return true;
      const primary = item.primaryFinding;
      return (
        primary.file.toLowerCase().includes(query) ||
        primary.title.toLowerCase().includes(query) ||
        primary.ruleId.toLowerCase().includes(query) ||
        primary.evidence.toLowerCase().includes(query)
      );
    });
  }, [findings, groups, filterSeverity, searchQuery]);
  
  const toggleGroup = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  const handleCopyPermalink = (findingId: string) => {
    const hash = `#finding-${findingId}`;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${hash}`).catch(() => {});
  };

  if (filteredItems.length === 0) {
    return (
      <div className="border-2 border-steampunk-brass bg-grey-iron p-8 text-center text-sm text-grey-ash font-mono">
        <span className="text-steampunk-brass">[</span>NO MATCHES<span className="text-steampunk-brass">]</span> No findings match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-2 border-steampunk-brass text-sm font-mono">
        <thead className="bg-grey-charcoal text-xs uppercase tracking-wider text-terminal-green-bright border-b-2 border-steampunk-brass">
          <tr>
            <th scope="col" className="px-4 py-3 text-left border-r-2 border-steampunk-brass">SEVERITY</th>
            <th scope="col" className="px-4 py-3 text-left border-r-2 border-steampunk-brass">RULE</th>
            <th scope="col" className="px-4 py-3 text-left border-r-2 border-steampunk-brass">FILE</th>
            <th scope="col" className="px-4 py-3 text-left border-r-2 border-steampunk-brass">OWASP</th>
            <th scope="col" className="px-4 py-3 text-left border-r-2 border-steampunk-brass">EVIDENCE</th>
            <th scope="col" className="px-4 py-3 text-left border-r-2 border-steampunk-brass">REMEDIATION</th>
            <th scope="col" className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y-2 divide-steampunk-brass">
          {filteredItems.map((group) => {
            const finding = group.primaryFinding;
            const isExpanded = expandedGroups.has(group.id);
            const hasRelated = group.relatedFindings.length > 0;
            
            return (
              <React.Fragment key={group.id}>
                <tr id={`finding-${finding.id}`} className="align-top border-b border-steampunk-brass bg-grey-iron hover:bg-grey-slate">
                  <td className="px-4 py-4 border-r-2 border-steampunk-brass">
                    <div className="flex items-center gap-2">
                      {hasRelated && (
                        <button
                          onClick={() => toggleGroup(group.id)}
                          className="text-steampunk-brass hover:text-steampunk-brass-bright font-bold"
                          aria-label={isExpanded ? "Collapse" : "Expand"}
                        >
                          {isExpanded ? "[−]" : "[+]"}
                        </button>
                      )}
                      <span className={`inline-flex px-3 py-1 text-xs uppercase ${SEVERITY_COLORS[group.severity]}`}>
                        {group.severity.toUpperCase()}
                        {group.riskBoost > 0 && " ⚠"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 border-r-2 border-steampunk-brass">
                    <div className="text-terminal-green-bright font-bold">{finding.title}</div>
                    <div className="text-xs text-grey-ash font-mono">{finding.ruleId}</div>
                    {hasRelated && (
                      <div className="mt-1 text-xs text-steampunk-brass">
                        <span className="text-steampunk-brass">+</span>{group.relatedFindings.length} related finding{group.relatedFindings.length !== 1 ? "s" : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 border-r-2 border-steampunk-brass">
                    <code className="border border-steampunk-brass bg-grey-charcoal px-2 py-1 text-xs text-terminal-green font-mono">
                      {finding.file}
                      {finding.line ? `:${finding.line}` : ""}
                    </code>
                  </td>
                  <td className="px-4 py-4 border-r-2 border-steampunk-brass">
                    <ul className="flex flex-col gap-1 text-xs text-terminal-green">
                      {finding.owasp.map((id) => {
                        const meta = owasp[id];
                        return (
                          <li key={id}>
                            <span className="font-bold text-terminal-green-bright">{id}</span>
                            {meta ? <span className="text-steampunk-brass"> · </span> : ""}
                            {meta ? <span className="text-grey-ash">{meta.title}</span> : ""}
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                  <td className="px-4 py-4 text-xs border-r-2 border-steampunk-brass">
                    <code className="block whitespace-pre-wrap border border-steampunk-brass bg-grey-charcoal px-3 py-2 text-terminal-green font-mono">
                      {finding.evidence}
                    </code>
                  </td>
                  <td className="px-4 py-4 text-xs text-grey-ash border-r-2 border-steampunk-brass">{finding.remediation}</td>
                  <td className="px-4 py-4 text-right">
                    <button
                      onClick={() => handleCopyPermalink(finding.id)}
                      className="text-xs text-steampunk-brass hover:text-steampunk-brass-bright font-bold uppercase font-mono"
                    >
                      [COPY]
                    </button>
                  </td>
                </tr>
                {hasRelated && isExpanded && group.relatedFindings.map((related) => (
                  <tr key={related.id} className="bg-grey-charcoal align-top border-b border-steampunk-brass-dim">
                    <td className="px-4 py-2 pl-12 border-r-2 border-steampunk-brass-dim">
                      <span className={`inline-flex px-2 py-0.5 text-xs uppercase ${SEVERITY_COLORS[related.severity]}`}>
                        {related.severity.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2 border-r-2 border-steampunk-brass-dim">
                      <div className="text-sm text-terminal-green">{related.title}</div>
                      <div className="text-xs text-grey-ash font-mono">{related.ruleId}</div>
                    </td>
                    <td className="px-4 py-2 border-r-2 border-steampunk-brass-dim">
                      <code className="border border-steampunk-brass-dim bg-grey-iron px-2 py-0.5 text-xs text-grey-ash font-mono">
                        {related.file}
                        {related.line ? `:${related.line}` : ""}
                      </code>
                    </td>
                    <td className="px-4 py-2 border-r-2 border-steampunk-brass-dim">
                      <ul className="flex flex-col gap-1 text-xs text-grey-ash">
                        {related.owasp.map((id) => {
                          const meta = owasp[id];
                          return (
                            <li key={id}>
                              <span className="font-bold text-terminal-green">{id}</span>
                              {meta ? <span className="text-steampunk-brass"> · </span> : ""}
                              {meta ? <span className="text-grey-ash">{meta.title}</span> : ""}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                    <td className="px-4 py-2 text-xs border-r-2 border-steampunk-brass-dim">
                      <code className="block whitespace-pre-wrap border border-steampunk-brass-dim bg-grey-iron px-2 py-1 text-grey-ash font-mono">
                        {related.evidence}
                      </code>
                    </td>
                    <td className="px-4 py-2 text-xs text-grey-ash border-r-2 border-steampunk-brass-dim">{related.remediation}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => handleCopyPermalink(related.id)}
                        className="text-xs text-steampunk-brass hover:text-steampunk-brass-bright font-bold uppercase font-mono"
                      >
                        [COPY]
                      </button>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default FindingsTable;
