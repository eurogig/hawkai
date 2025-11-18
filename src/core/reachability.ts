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

// Performance caps
const MAX_FILES_FOR_CALL_EDGES = 200; // Max files to process for call-edge extraction
const MAX_CALL_EDGES_PER_FILE = 100; // Max call edges to extract per file
const MAX_TOTAL_CALL_EDGES = 5000; // Max total call edges to add to graph
const MAX_NODES_FOR_PROPAGATION = 100; // Max high-confidence nodes for path propagation
const MAX_SOURCE_NODES = 200; // Max source nodes to consider for risky paths
const MAX_SINK_NODES = 200; // Max sink nodes to consider for risky paths

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

  // Cap number of files to process
  const filesToProcess = Array.from(filesWithFindings).slice(0, MAX_FILES_FOR_CALL_EDGES);

  let callEdgeCount = 0;
  for (const file of filesToProcess) {
    // Stop if we've added too many edges
    if (callEdgeCount >= MAX_TOTAL_CALL_EDGES) {
      break;
    }
    const content = fileContents.get(file);
    if (!content) continue;

    try {
      const callGraph = extractCallEdges(file, content);
      
      // Cap call edges per file
      const edgesToProcess = callGraph.edges.slice(0, MAX_CALL_EDGES_PER_FILE);
      
      // Map call edges to graph nodes
      let edgesAddedThisFile = 0;
      for (const callEdge of edgesToProcess) {
        // Stop if we've added too many total edges
        if (callEdgeCount >= MAX_TOTAL_CALL_EDGES) {
          break;
        }
        
        // Stop if we've added too many edges for this file
        if (edgesAddedThisFile >= MAX_CALL_EDGES_PER_FILE) {
          break;
        }
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
          edgesAddedThisFile++;
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

  // Start path finding from high-confidence nodes (capped for performance)
  const highConfNodes = graph.nodes
    .filter(n => (n.compositeScore ?? n.confidence ?? 0) >= 0.7)
    .sort((a, b) => (b.compositeScore ?? b.confidence ?? 0) - (a.compositeScore ?? a.confidence ?? 0))
    .slice(0, MAX_NODES_FOR_PROPAGATION)
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

export interface RiskyPath {
  source: GraphNode;
  transforms: GraphNode[]; // Model/agent nodes in the path
  sink: GraphNode;
  path: GraphNode[]; // Full path from source to sink
  confidence: number; // Combined confidence score [0-1]
  riskLevel: "critical" | "high" | "moderate" | "low";
}

/**
 * Detect risky paths: untrusted input → model/agent → tool execution.
 * - Sources: user input, HTTP params, CLI args, env/config, file reads
 * - Transforms: LLM calls, agent executions, RAG retrieval
 * - Sinks: filesystem ops, shell commands, network calls, DB operations
 */
export function detectRiskyPaths(graph: ReachabilityGraph): RiskyPath[] {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
  }

  // Build adjacency list (reverse: to -> from for backwards traversal)
  const reverseAdj = new Map<string, GraphEdge[]>();
  const forwardAdj = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (!reverseAdj.has(edge.to)) {
      reverseAdj.set(edge.to, []);
    }
    reverseAdj.get(edge.to)!.push(edge);
    
    if (!forwardAdj.has(edge.from)) {
      forwardAdj.set(edge.from, []);
    }
    forwardAdj.get(edge.from)!.push(edge);
  }

  // Identify source nodes (untrusted input patterns)
  // Tools CAN be sources if they receive untrusted input (tool → model → tool pattern)
  const isSourceNode = (node: GraphNode): boolean => {
    const label = node.label.toLowerCase();
    const file = node.file?.toLowerCase() || "";
    const nodeId = node.id.toLowerCase();
    
    // Check for Streamlit input rule ID (check both nodeId and label)
    if (nodeId.includes("ag-streamlit-input") || label.includes("ag-streamlit-input")) {
      console.debug(`[Reachability] Streamlit node detected as source: ${node.id} (label: ${node.label})`);
      return true;
    }
    
    // Check if this is a tool node that receives input (tools can be sources)
    const isToolNode = /tool|uses_tool|ag-tool|ag-function/i.test(nodeId) || 
                       /ag-tool|ag-function/i.test(label);
    
    // Check call edges (which we extracted from code) - look for imports/calls to input APIs
    const edgesFromNode = forwardAdj.get(node.id) || [];
    for (const edge of edgesFromNode) {
      const target = edge.to.toLowerCase();
      // Import patterns for input sources
      if (/input|argv|args|stdin|readline|argparse|click|dotenv|process\.env|getenv|readfile|read\(|open\(|streamlit|st\./i.test(target)) {
        return true;
      }
      // HTTP/request patterns (incoming)
      if (/request|fetch|http|body|query|params|headers/i.test(target) && edge.kind !== "uses_tool") {
        return true;
      }
    }
    
    // Tools can be sources if they have incoming edges from input sources
    if (isToolNode) {
      const incomingEdges = reverseAdj.get(node.id) || [];
      // If tool receives input from user/HTTP/env/file sources, it's a source
      for (const edge of incomingEdges) {
        const sourceNode = nodesById.get(edge.from);
        if (sourceNode) {
          const sourceLabel = sourceNode.label.toLowerCase();
          const sourceId = sourceNode.id.toLowerCase();
          // Check if incoming from input patterns
          if (/input|argv|args|stdin|request|fetch|http|body|query|params|env|config|readfile|read\(|streamlit|st\./i.test(sourceLabel + sourceId)) {
            return true;
          }
        }
      }
    }
    
    // User input patterns in label/file
    if (/input|argv|args|stdin|readline|request\.(body|query|params|headers)|req\.(body|query|params|headers)/i.test(label + file + nodeId)) {
      return true;
    }
    // Streamlit input patterns (st.text_input, st.chat_input, st.text_area, etc.)
    if (/st\.(text_input|chat_input|text_area|number_input|selectbox|multiselect|slider|file_uploader|text|write)/i.test(label + file + nodeId)) {
      return true;
    }
    // File reads (but not writes)
    if (/readfile|open\(.*['"']r|read\(|\.read\(|fs\.read/i.test(label + file + nodeId) && !/write/i.test(label + file + nodeId)) {
      return true;
    }
    // Environment/config
    if (/process\.env|getenv|os\.getenv|dotenv|config|settings/i.test(label + file + nodeId)) {
      return true;
    }
    // CLI arguments
    if (/argparse|click|sys\.argv|process\.argv/i.test(label + file + nodeId)) {
      return true;
    }
    // HTTP requests (incoming, not outgoing)
    if (/request|fetch|http\.|url|query|body|params/i.test(label) || /http|api|endpoint/i.test(file)) {
      // Also check if this node has edges to HTTP-related targets (but not outgoing posts/puts)
      if (edgesFromNode.some(e => /http|request|fetch|api/i.test(e.to) && !/post|put|send|publish/i.test(e.to))) {
        return true;
      }
    }
    
    return false;
  };

  // Identify transform nodes (model/agent calls)
  // Exclude tools - tools are sources/sinks, not transforms
  const isTransformNode = (node: GraphNode): boolean => {
    const label = node.label.toLowerCase();
    const ruleId = node.id.toLowerCase();
    
    // Exclude tool nodes (tools are sources/sinks, not transforms)
    if (/ag-tool|ag-function|tool-class|tool-list|tool-decorator|uses_tool/i.test(ruleId) || 
        /ag-tool|ag-function/i.test(label)) {
      return false;
    }
    
    // LLM calls (but not tool invocations)
    if (/chat\.completions|completions\.create/i.test(label + ruleId) ||
        (/invoke|stream|run/i.test(label + ruleId) && !/tool/i.test(ruleId))) {
      return true;
    }
    // Agent frameworks (but not tool classes)
    if (/langgraph|langchain|crewai|autogen/i.test(ruleId) ||
        (/agent|graph|chain/i.test(label + ruleId) && !/tool/i.test(ruleId))) {
      return true;
    }
    // RAG retrieval
    if (/rag|retrieval|vector|embedding/i.test(label + ruleId)) {
      return true;
    }
    // Model usage (direct model/endpoint usage)
    if (/uses_model|uses_endpoint|openai|anthropic|model/i.test(ruleId)) {
      return true;
    }
    
    return false;
  };

  // Identify sink nodes (tool executions)
  const isSinkNode = (node: GraphNode): boolean => {
    const label = node.label.toLowerCase();
    const ruleId = node.id.toLowerCase();
    
    // Check call edges (which we extracted from code) - look for calls to tool/execution APIs
    const edgesFromNode = forwardAdj.get(node.id) || [];
    for (const edge of edgesFromNode) {
      const target = edge.to.toLowerCase();
      // Tool-related calls
      if (/tool|execute|run|invoke|call/i.test(target) && edge.kind === "uses_tool") {
        return true;
      }
      // Filesystem operations
      if (/writefile|writetext|open|write|system|exec|shell|subprocess/i.test(target)) {
        return true;
      }
      // Network operations
      if (/fetch|post|put|send|publish|smtp|http/i.test(target)) {
        return true;
      }
      // Database operations
      if (/execute|query|commit|insert|update|delete|db|database/i.test(target)) {
        return true;
      }
    }
    
    // Filesystem operations
    if (/writefile|writetext|open\(.*['"']w|os\.system|subprocess|exec|shell/i.test(label + ruleId)) {
      return true;
    }
    // Tool usage (from call edges - check edge kind)
    const hasToolEdge = edgesFromNode.some(e => e.kind === "uses_tool");
    if (hasToolEdge || /uses_tool|tool|execute|run/i.test(ruleId)) {
      return true;
    }
    // Network calls (outbound)
    if (/fetch|request\.post|request\.put|http\.post|smtp|send|publish/i.test(label)) {
      return true;
    }
    // Database operations
    if (/execute|query|commit|insert|update|delete|db\.|database/i.test(label + ruleId)) {
      return true;
    }
    // Shell/system commands
    if (/system|exec|spawn|shell=true|subprocess/i.test(label + ruleId)) {
      return true;
    }
    
    return false;
  };

  // Classify nodes (capped for performance)
  const allSourceNodes = graph.nodes.filter(isSourceNode);
  console.debug(`[Reachability] Found ${allSourceNodes.length} source nodes out of ${graph.nodes.length} total nodes`);
  const streamlitSources = allSourceNodes.filter(n => 
    n.id.toLowerCase().includes("ag-streamlit-input") || 
    n.label.toLowerCase().includes("ag-streamlit-input")
  );
  if (streamlitSources.length > 0) {
    console.debug(`[Reachability] Streamlit source nodes:`, streamlitSources.map(n => ({ id: n.id, label: n.label, file: n.file })));
  }
  const allSinkNodes = graph.nodes.filter(isSinkNode);
  
  // Prioritize high-confidence sources and sinks, cap total
  const sourceNodes = allSourceNodes
    .sort((a, b) => (b.compositeScore ?? b.confidence ?? 0) - (a.compositeScore ?? a.confidence ?? 0))
    .slice(0, MAX_SOURCE_NODES);
  
  const sinkNodes = allSinkNodes
    .sort((a, b) => (b.compositeScore ?? b.confidence ?? 0) - (a.compositeScore ?? a.confidence ?? 0))
    .slice(0, MAX_SINK_NODES);

  // Find paths: source → [transforms] → sink
  const riskyPaths: RiskyPath[] = [];
  const MAX_PATH_LENGTH = 6; // Limit path traversal

  function findPathToSink(
    start: string,
    sink: string,
    visited: Set<string>,
    path: GraphNode[],
    transforms: GraphNode[],
    depth: number
  ): void {
    if (depth > MAX_PATH_LENGTH || visited.has(start)) {
      return;
    }

    const currentNode = nodesById.get(start);
    if (!currentNode) return;

    visited.add(start);
    path.push(currentNode);

    // Track transforms in path
    if (isTransformNode(currentNode)) {
      transforms.push(currentNode);
    }

    // Check if we reached the sink
    if (start === sink && transforms.length > 0) {
      // Calculate path confidence
      let pathConf = 1.0;
      for (const node of path) {
        const nodeConf = node.compositeScore ?? node.confidence ?? 0.5;
        pathConf *= nodeConf;
      }
      // Apply decay for path length
      pathConf *= Math.pow(0.9, path.length - 1);
      
      // Determine risk level
      let riskLevel: RiskyPath["riskLevel"] = "low";
      if (pathConf >= 0.8) riskLevel = "critical";
      else if (pathConf >= 0.6) riskLevel = "high";
      else if (pathConf >= 0.4) riskLevel = "moderate";

      riskyPaths.push({
        source: path[0],
        transforms: [...transforms],
        sink: path[path.length - 1],
        path: [...path],
        confidence: Math.max(0, Math.min(1, pathConf)),
        riskLevel
      });
    } else {
      // Continue traversal
      const edges = forwardAdj.get(start) || [];
      for (const edge of edges) {
        // Prefer high-weight edges
        if ((edge.weight ?? 0.5) >= 0.3) {
          findPathToSink(edge.to, sink, visited, path, transforms, depth + 1);
        }
      }
    }

    path.pop();
    if (isTransformNode(currentNode)) {
      transforms.pop();
    }
    visited.delete(start);
  }

  // Find paths from each source to each sink
  // Ensure source != sink (prevent self-loops) and there's at least one transform between them
  for (const source of sourceNodes) {
    for (const sink of sinkNodes) {
      // Skip if source and sink are the same node (self-loop)
      if (source.id === sink.id) {
        continue;
      }
      findPathToSink(source.id, sink.id, new Set(), [], [], 0);
    }
  }

  // Deduplicate and sort by confidence (highest first)
  const uniquePaths = new Map<string, RiskyPath>();
  for (const path of riskyPaths) {
    const key = `${path.source.id}→${path.sink.id}`;
    const existing = uniquePaths.get(key);
    if (!existing || path.confidence > existing.confidence) {
      uniquePaths.set(key, path);
    }
  }

  return Array.from(uniquePaths.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 50); // Limit to top 50 risky paths
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


