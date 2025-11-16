import type { Finding, FindingGroup, Severity } from "@/types";

export type NodeKind = "code" | "ai" | "finding";
export type EdgeKind = "related" | "uses_model" | "uses_tool" | "uses_endpoint" | "calls" | "data_flow";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  file?: string;
  line?: number | null;
  severity?: Severity;
  confidence?: number;
  category?: string;
  compositeScore?: number;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  weight?: number; // optional confidence/score for the edge
  label?: string;
}

export interface ReachabilityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
  };
}

/**
 * Build a coarse reachability graph from grouped findings.
 * - Creates a node per finding (primary and related)
 * - Adds edges from primary -> related in each group
 * - Annotates nodes with severity, confidence, compositeScore (if present)
 * 
 * This is intentionally conservative; deeper call/data edges will be added in later steps.
 */
export function buildCoarseGraph(groups: FindingGroup[]): ReachabilityGraph {
  const nodesById = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  function nodeIdForFinding(f: Finding): string {
    // Stable-enough ID: ruleId|file|line
    return `${f.ruleId}|${f.file}|${f.line ?? "null"}`;
  }

  function upsertNodeForFinding(f: Finding, compositeScore?: number): GraphNode {
    const id = nodeIdForFinding(f);
    let n = nodesById.get(id);
    if (!n) {
      n = {
        id,
        kind: "finding",
        label: f.ruleId,
        file: f.file,
        line: f.line ?? null,
        severity: f.severity,
        confidence: f.confidence,
        category: f.category,
        compositeScore
      };
      nodesById.set(id, n);
    } else {
      // keep highest severity and confidence/composite seen
      n.severity = pickHigherSeverity(n.severity, f.severity);
      n.confidence = Math.max(n.confidence ?? 0, f.confidence ?? 0);
      if (compositeScore != null) {
        n.compositeScore = Math.max(n.compositeScore ?? 0, compositeScore);
      }
    }
    return n;
  }

  for (const g of groups) {
    const primaryNode = upsertNodeForFinding(g.primaryFinding, g.compositeScore);
    for (const r of g.relatedFindings) {
      const relatedNode = upsertNodeForFinding(r, g.compositeScore);
      const edgeId = `rel|${primaryNode.id}->${relatedNode.id}`;
      edges.push({
        id: edgeId,
        kind: "related",
        from: primaryNode.id,
        to: relatedNode.id,
        weight: Math.max(g.compositeScore ?? 0, r.confidence ?? 0),
        label: "related"
      });
    }
  }

  const nodes = Array.from(nodesById.values());
  return {
    nodes,
    edges,
    stats: { nodeCount: nodes.length, edgeCount: edges.length }
  };
}

export function toDot(graph: ReachabilityGraph): string {
  const lines: string[] = [];
  lines.push("digraph G {");
  lines.push('  rankdir=LR;');
  for (const n of graph.nodes) {
    const label = `${n.label}\\n${n.file ?? ""}${n.line ? `:${n.line}` : ""}`;
    lines.push(`  "${n.id.replace(/"/g, '\\"')}" [label="${label}"];`);
  }
  for (const e of graph.edges) {
    const lbl = e.label ? ` [label="${e.label}"]` : "";
    lines.push(`  "${e.from.replace(/"/g, '\\"')}" -> "${e.to.replace(/"/g, '\\"')}"${lbl};`);
  }
  lines.push("}");
  return lines.join("\n");
}

export function toMermaid(graph: ReachabilityGraph): string {
  const lines: string[] = [];
  lines.push("flowchart LR");
  for (const n of graph.nodes) {
    const label = `${n.label}${n.file ? `\\n${n.file}${n.line ? `:${n.line}` : ""}` : ""}`;
    lines.push(`  ${safeId(n.id)}["${label}"]`);
  }
  for (const e of graph.edges) {
    const lbl = e.label ? `|${e.label}|` : "";
    lines.push(`  ${safeId(e.from)} -->${lbl} ${safeId(e.to)}`);
  }
  return lines.join("\n");
}

function safeId(id: string): string {
  return "N" + Buffer.from(id).toString("hex").slice(0, 24);
}

function pickHigherSeverity(a?: Severity, b?: Severity): Severity | undefined {
  if (!a) return b;
  if (!b) return a;
  const order: Record<Severity, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
  return (order[a] >= order[b]) ? a : b;
}


