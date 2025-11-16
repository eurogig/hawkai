import type { Finding, FindingGroup, Severity } from "@/types";
import { extractCallEdges, type CallGraph } from "./callEdges";

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

/**
 * Enrich a coarse graph with call edges extracted from source files.
 * Maps call edges to finding nodes based on file/line proximity.
 */
export function enrichGraphWithCallEdges(
  graph: ReachabilityGraph,
  groups: FindingGroup[],
  fileContents: Map<string, string>
): ReachabilityGraph {
  const enrichedEdges = [...graph.edges];
  const nodeIdMap = new Map<string, GraphNode>();
  
  // Build map from (file, line) to node IDs for quick lookup
  for (const node of graph.nodes) {
    if (node.file && node.line != null) {
      const key = `${node.file}:${node.line}`;
      if (!nodeIdMap.has(key)) {
        nodeIdMap.set(key, node);
      }
    }
  }

  // Process files that have findings
  const filesWithFindings = new Set<string>();
  for (const group of groups) {
    if (group.primaryFinding.file) {
      filesWithFindings.add(group.primaryFinding.file);
    }
    for (const r of group.relatedFindings) {
      if (r.file) {
        filesWithFindings.add(r.file);
      }
    }
  }

  let callEdgeCount = 0;
  for (const file of filesWithFindings) {
    const content = fileContents.get(file);
    if (!content) continue;

    try {
      const callGraph = extractCallEdges(file, content);
      
      // Map call edges to graph nodes
      for (const callEdge of callGraph.edges) {
        // Find nodes in the same file (prefer same line, otherwise closest)
        const candidateNodes = Array.from(graph.nodes).filter(n => n.file === file);
        if (candidateNodes.length === 0) continue;

        // Find source node (from)
        let fromNode: GraphNode | null = null;
        if (callEdge.line != null) {
          fromNode = candidateNodes.find(n => n.line === callEdge.line) || null;
        }
        if (!fromNode) {
          // Find closest node by line number
          fromNode = candidateNodes.reduce((closest, n) => {
            if (!n.line || !callEdge.line) return closest;
            if (!closest) return n;
            const distN = Math.abs(n.line - callEdge.line);
            const distClosest = Math.abs(closest.line! - callEdge.line);
            return distN < distClosest ? n : closest;
          }, null as GraphNode | null);
        }

        // Map edge kind based on call type
        let edgeKind: EdgeKind = "calls";
        if (callEdge.kind === "import") {
          // Check if importing AI-related modules
          if (callEdge.to.includes("openai") || callEdge.to.includes("anthropic") || 
              callEdge.to.includes("langchain") || callEdge.to.includes("langgraph") ||
              callEdge.to.includes("crewai") || callEdge.to.includes("autogen")) {
            edgeKind = "uses_model";
          }
        } else if (callEdge.kind === "method" || callEdge.kind === "call") {
          // Check if calling tool-related methods
          const toolMethods = /(invoke|stream|call|tool|execute|run)/i;
          if (toolMethods.test(callEdge.to)) {
            edgeKind = "uses_tool";
          } else if (/endpoint|api|client/i.test(callEdge.to)) {
            edgeKind = "uses_endpoint";
          }
        }

        // Create edge from source node to target (use "to" as label)
        if (fromNode) {
          const edgeId = `call|${fromNode.id}->${callEdge.to}`;
          enrichedEdges.push({
            id: edgeId,
            kind: edgeKind,
            from: fromNode.id,
            to: callEdge.to,
            weight: callEdge.confidence,
            label: callEdge.to
          });
          callEdgeCount++;
        }
      }
    } catch (error) {
      // Silently skip files that fail to parse
      console.warn(`Failed to extract call edges from ${file}:`, error);
    }
  }

  return {
    ...graph,
    edges: enrichedEdges,
    stats: {
      nodeCount: graph.nodes.length,
      edgeCount: enrichedEdges.length
    }
  };
}

/**
 * Propagate confidence along paths and update edge weights.
 * - Calculates edge weights based on source/target node confidence
 * - Finds paths and applies confidence decay (longer paths = lower confidence)
 * - Updates edge weights to reflect path-based confidence
 */
export function propagateConfidence(graph: ReachabilityGraph): ReachabilityGraph {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
  }

  // Build adjacency list
  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, []);
    }
    adjacency.get(edge.from)!.push(edge);
  }

  // Calculate base edge weights from node confidence
  const edgeWeights = new Map<string, number>();
  for (const edge of graph.edges) {
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    
    // Base weight: combine source and target confidence, or use existing weight
    let baseWeight = edge.weight ?? 0.5;
    
    if (fromNode && toNode) {
      const fromConf = fromNode.compositeScore ?? fromNode.confidence ?? 0.5;
      const toConf = toNode.compositeScore ?? toNode.confidence ?? 0.5;
      // Geometric mean of source and target confidence
      baseWeight = Math.sqrt(fromConf * toConf);
    } else if (fromNode) {
      baseWeight = fromNode.compositeScore ?? fromNode.confidence ?? 0.5;
    } else if (toNode) {
      baseWeight = toNode.compositeScore ?? toNode.confidence ?? 0.5;
    }
    
    // Boost certain edge kinds
    let kindBoost = 1.0;
    if (edge.kind === "uses_model" || edge.kind === "uses_tool") {
      kindBoost = 1.15; // 15% boost for AI-specific edges
    } else if (edge.kind === "uses_endpoint") {
      kindBoost = 1.2; // 20% boost for endpoint edges (highest risk)
    }
    
    baseWeight = Math.min(1.0, baseWeight * kindBoost);
    edgeWeights.set(edge.id, baseWeight);
  }

  // Find paths and apply confidence decay
  const DECAY_RATE = 0.85; // Each hop reduces confidence by 15%
  const MAX_PATH_LENGTH = 5; // Limit path traversal depth
  const pathScores = new Map<string, number>(); // edge id -> best path score

  function findPaths(
    start: string,
    visited: Set<string>,
    pathLength: number,
    depth: number
  ): void {
    if (depth > MAX_PATH_LENGTH || visited.has(start)) {
      return;
    }

    visited.add(start);

    const edges = adjacency.get(start) || [];
    for (const edge of edges) {
      const edgeWeight = edgeWeights.get(edge.id) ?? 0.5;
      // Apply decay based on path length (number of hops so far)
      const pathConfidence = edgeWeight * Math.pow(DECAY_RATE, pathLength);
      
      // Track best path score for each edge
      const current = pathScores.get(edge.id) ?? 0;
      pathScores.set(edge.id, Math.max(current, pathConfidence));

      // Continue traversal (increment path length when following edge)
      if (!visited.has(edge.to)) {
        findPaths(edge.to, visited, pathLength + 1, depth + 1);
      }
    }

    visited.delete(start);
  }

  // Start path finding from high-confidence nodes
  const highConfNodes = graph.nodes
    .filter(n => (n.compositeScore ?? n.confidence ?? 0) >= 0.7)
    .map(n => n.id);
  
  for (const nodeId of highConfNodes) {
    findPaths(nodeId, new Set(), 0, 0);
  }

  // Update edge weights with propagated confidence
  const updatedEdges = graph.edges.map(edge => {
    const baseWeight = edgeWeights.get(edge.id) ?? edge.weight ?? 0.5;
    const pathScore = pathScores.get(edge.id) ?? 0;
    
    // Combine base weight and path score (weighted average)
    const finalWeight = baseWeight * 0.6 + pathScore * 0.4;
    
    return {
      ...edge,
      weight: Math.max(0, Math.min(1.0, finalWeight))
    };
  });

  return {
    ...graph,
    edges: updatedEdges,
    stats: {
      nodeCount: graph.nodes.length,
      edgeCount: updatedEdges.length
    }
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
  
  // Create stable mapping from original IDs to Mermaid-safe IDs
  const idMap = new Map<string, string>();
  let counter = 0;
  
  function safeId(originalId: string): string {
    if (!idMap.has(originalId)) {
      // Use counter-based IDs for stability and readability
      const safe = `N${counter++}`;
      idMap.set(originalId, safe);
    }
    return idMap.get(originalId)!;
  }
  
  // Deduplicate nodes by Mermaid ID (in case of hash collisions)
  const seenNodes = new Set<string>();
  for (const n of graph.nodes) {
    const mermaidId = safeId(n.id);
    if (seenNodes.has(mermaidId)) continue;
    seenNodes.add(mermaidId);
    const label = `${n.label}${n.file ? `\\n${n.file}${n.line ? `:${n.line}` : ""}` : ""}`;
    lines.push(`  ${mermaidId}["${label}"]`);
  }
  
  for (const e of graph.edges) {
    const lbl = e.label ? `|${e.label}|` : "";
    lines.push(`  ${safeId(e.from)} -->${lbl} ${safeId(e.to)}`);
  }
  return lines.join("\n");
}

function pickHigherSeverity(a?: Severity, b?: Severity): Severity | undefined {
  if (!a) return b;
  if (!b) return a;
  const order: Record<Severity, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
  return (order[a] >= order[b]) ? a : b;
}


