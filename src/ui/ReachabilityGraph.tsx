import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { ReachabilityGraph, RiskyPath } from "@/types";

interface ReachabilityGraphProps {
  graph?: ReachabilityGraph;
  riskyPaths?: RiskyPath[];
  onClose: () => void;
}

export default function ReachabilityGraphView({ graph, riskyPaths = [], onClose }: ReachabilityGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selectedPath, setSelectedPath] = useState<RiskyPath | null>(null);
  const [filterRiskLevel, setFilterRiskLevel] = useState<string>("all");

  useEffect(() => {
    if (!graph || !containerRef.current) return;

    // Initialize Cytoscape
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        // Convert graph nodes to Cytoscape elements
        ...graph.nodes.map((node) => ({
          data: {
            id: node.id,
            label: node.label,
            file: node.file,
            line: node.line,
            severity: node.severity,
            confidence: node.compositeScore ?? node.confidence ?? 0.5,
            kind: node.kind,
          },
          classes: [
            `severity-${node.severity || "low"}`,
            `kind-${node.kind}`,
          ].filter(Boolean).join(" "),
        })),
        // Convert graph edges to Cytoscape elements
        ...graph.edges.map((edge) => ({
          data: {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            label: edge.label || edge.kind,
            kind: edge.kind,
            weight: edge.weight ?? 0.5,
          },
          classes: [`edge-${edge.kind}`],
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#8B7355", // steampunk-brass
            "label": "data(label)",
            "width": "mapData(confidence, 0, 1, 20, 60)",
            "height": "mapData(confidence, 0, 1, 20, 60)",
            "font-size": "10px",
            "text-wrap": "wrap",
            "text-max-width": "80px",
            "text-valign": "center",
            "text-halign": "center",
            "color": "#E8D4A6", // terminal-green
            "border-width": 2,
            "border-color": "#D4AF37", // steampunk-brass-bright
          },
        },
        {
          selector: "node.severity-critical",
          style: {
            "background-color": "#8B0000", // dark red
            "border-color": "#FF4444",
          },
        },
        {
          selector: "node.severity-high",
          style: {
            "background-color": "#CC6600", // orange
            "border-color": "#FF8844",
          },
        },
        {
          selector: "node.severity-moderate",
          style: {
            "background-color": "#8B7355", // steampunk-brass
            "border-color": "#D4AF37",
          },
        },
        {
          selector: "node.severity-low",
          style: {
            "background-color": "#4A4A4A", // grey
            "border-color": "#888888",
          },
        },
        {
          selector: "edge",
          style: {
            "width": "mapData(weight, 0, 1, 1, 4)",
            "line-color": "#8B7355",
            "target-arrow-color": "#8B7355",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "opacity": "mapData(weight, 0, 1, 0.3, 1)",
          },
        },
        {
          selector: "edge.edge-uses_tool",
          style: {
            "line-color": "#FF4444", // red for tool usage
            "target-arrow-color": "#FF4444",
          },
        },
        {
          selector: "edge.edge-uses_model",
          style: {
            "line-color": "#FF8844", // orange for model usage
            "target-arrow-color": "#FF8844",
          },
        },
        {
          selector: "edge.edge-uses_endpoint",
          style: {
            "line-color": "#FFAA44", // yellow-orange for endpoints
            "target-arrow-color": "#FFAA44",
          },
        },
      ],
      layout: {
        name: "cose", // Compound Spring Embedder
        idealEdgeLength: 100,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 30,
        randomize: false,
        componentSpacing: 100,
        nodeRepulsion: 4500,
        nestingFactor: 0.1,
        gravity: 0.25,
        numIter: 2500,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
      },
    });

    cyRef.current = cy;

    // Node click handler
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      const nodeData = node.data();
      console.log("Node clicked:", nodeData);
      // TODO: Show node details, jump to file/line
    });

    // Edge click handler
    cy.on("tap", "edge", (evt) => {
      const edge = evt.target;
      const edgeData = edge.data();
      console.log("Edge clicked:", edgeData);
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph]);

  // Highlight risky paths
  useEffect(() => {
    if (!cyRef.current || !riskyPaths.length) return;

    const cy = cyRef.current;
    
    // Clear previous highlights
    cy.elements().removeClass("risky-path");

    // Filter risky paths by risk level
    const filteredPaths = filterRiskLevel === "all" 
      ? riskyPaths 
      : riskyPaths.filter(p => p.riskLevel === filterRiskLevel);

    // Highlight paths
    filteredPaths.forEach((path, idx) => {
      // Highlight nodes in path
      path.path.forEach((node, nodeIdx) => {
        const cyNode = cy.getElementById(node.id);
        if (cyNode.length > 0) {
          cyNode.addClass("risky-path");
          // Color by risk level
          if (path.riskLevel === "critical") {
            cyNode.style("background-color", "#8B0000");
          } else if (path.riskLevel === "high") {
            cyNode.style("background-color", "#CC6600");
          }
        }
      });

      // Highlight edges between consecutive nodes
      for (let i = 0; i < path.path.length - 1; i++) {
        const fromId = path.path[i].id;
        const toId = path.path[i + 1].id;
        const edge = cy.edges().filter(e => 
          e.source().id() === fromId && e.target().id() === toId
        );
        if (edge.length > 0) {
          edge.addClass("risky-path");
          edge.style("line-color", path.riskLevel === "critical" ? "#FF0000" : "#FF8844");
          edge.style("width", 5);
        }
      }
    });

    // Fit to highlighted elements
    if (filteredPaths.length > 0) {
      const highlighted = cy.elements(".risky-path");
      if (highlighted.length > 0) {
        cy.fit(highlighted, 50);
      }
    }
  }, [riskyPaths, filterRiskLevel]);

  if (!graph) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
      <div className="relative w-[90vw] h-[90vh] border-2 border-steampunk-brass bg-grey-iron shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-2 border-steampunk-brass bg-grey-steel">
          <h3 className="text-xl font-bold text-terminal-green-bright uppercase">
            <span className="text-steampunk-brass">[</span>REACHABILITY GRAPH<span className="text-steampunk-brass">]</span>
          </h3>
          <div className="flex items-center gap-4">
            {/* Risk level filter */}
            <select
              value={filterRiskLevel}
              onChange={(e) => setFilterRiskLevel(e.target.value)}
              className="bg-grey-charcoal border-2 border-steampunk-brass text-terminal-green px-3 py-1 text-sm"
            >
              <option value="all">All Risk Levels</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="moderate">Moderate</option>
              <option value="low">Low</option>
            </select>
            <button
              onClick={onClose}
              className="px-4 py-2 border-2 border-steampunk-brass bg-grey-charcoal text-terminal-green hover:bg-steampunk-dark-wood font-bold"
            >
              Close
            </button>
          </div>
        </div>

        {/* Graph container */}
        <div className="flex-1 relative">
          <div ref={containerRef} className="w-full h-full" />
          
          {/* Risky paths sidebar */}
          {riskyPaths.length > 0 && (
            <div className="absolute top-4 right-4 w-80 max-h-[calc(100%-8rem)] overflow-y-auto bg-grey-iron border-2 border-steampunk-brass p-4 shadow-lg">
              <h4 className="text-sm font-bold text-terminal-green-bright mb-2 uppercase">
                <span className="text-steampunk-brass">[</span>RISKY PATHS<span className="text-steampunk-brass">]</span>
              </h4>
              <div className="space-y-2">
                {riskyPaths
                  .filter(p => filterRiskLevel === "all" || p.riskLevel === filterRiskLevel)
                  .slice(0, 20)
                  .map((path, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedPath(path)}
                      className={`p-2 border-2 cursor-pointer transition-colors ${
                        selectedPath === path
                          ? "border-steampunk-brass-bright bg-steampunk-dark-wood"
                          : "border-steampunk-brass bg-grey-charcoal hover:bg-grey-steel"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-bold px-2 py-1 ${
                          path.riskLevel === "critical" ? "bg-red-900 text-red-200" :
                          path.riskLevel === "high" ? "bg-orange-900 text-orange-200" :
                          path.riskLevel === "moderate" ? "bg-yellow-900 text-yellow-200" :
                          "bg-grey-ash text-grey-charcoal"
                        }`}>
                          {path.riskLevel.toUpperCase()}
                        </span>
                        <span className="text-xs text-grey-ash">
                          {Math.round(path.confidence * 100)}%
                        </span>
                      </div>
                      <div className="text-xs text-terminal-green space-y-1">
                        <div>
                          <span className="text-steampunk-brass">Source:</span> {path.source.label}
                        </div>
                        {path.transforms.length > 0 && (
                          <div>
                            <span className="text-steampunk-brass">Transform:</span> {path.transforms[0].label}
                          </div>
                        )}
                        <div>
                          <span className="text-steampunk-brass">Sink:</span> {path.sink.label}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Stats footer */}
        <div className="p-2 border-t-2 border-steampunk-brass bg-grey-steel text-xs text-grey-ash flex items-center justify-between">
          <span>
            <span className="text-steampunk-brass">[</span>NODES<span className="text-steampunk-brass">]</span> {graph.stats.nodeCount} 
            <span className="text-steampunk-brass"> | </span>
            <span className="text-steampunk-brass">[</span>EDGES<span className="text-steampunk-brass">]</span> {graph.stats.edgeCount}
          </span>
          <span>
            <span className="text-steampunk-brass">[</span>RISKY PATHS<span className="text-steampunk-brass">]</span> {riskyPaths.length}
          </span>
        </div>
      </div>
    </div>
  );
}

