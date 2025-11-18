import type { RiskyPath, GraphNode } from "./reachability";
import type { Inventory, FindingGroup, Report } from "@/types";
import type { RulePackIndex } from "@/types";

/**
 * Red-teaming plan schema
 */
export interface RedTeamingPlan {
  id: string;
  target: {
    label: string;
    file: string;
    line: number | null;
    type: "http_endpoint" | "cli" | "task" | "file" | "env" | "unknown";
  };
  path: {
    source: GraphNode;
    transforms: GraphNode[];
    sink: GraphNode;
    fullPath: GraphNode[];
  };
  risks: Array<{
    owasp: string;
    title: string;
    description: string;
    confidence: number;
  }>;
  attacks: Array<{
    title: string;
    description: string;
    category: "framework_specific" | "path_specific" | "general";
    priority: "critical" | "high" | "moderate" | "low";
  }>;
  frameworks: string[];
  tools: string[];
  confidence: number;
  riskLevel: "critical" | "high" | "moderate" | "low";
}

/**
 * Framework-specific attack patterns
 */
const FRAMEWORK_ATTACKS: Record<string, Array<{ title: string; description: string }>> = {
  langgraph: [
    {
      title: "Metadata poisoning in LangGraph nodes",
      description: "Attempt to inject malicious metadata or state variables that influence node behavior or branching logic."
    },
    {
      title: "Branching manipulation with malformed inputs",
      description: "Send malformed inputs to force unexpected state transitions or bypass intended control flow."
    },
    {
      title: "State graph manipulation",
      description: "Attempt to modify state graph structure or node execution order through prompt injection."
    },
    {
      title: "Tool coercion via state",
      description: "Manipulate state variables to coerce agent into executing unintended tools or actions."
    }
  ],
  langchain: [
    {
      title: "Chain manipulation via prompt injection",
      description: "Inject instructions to modify chain behavior, skip steps, or execute unintended actions."
    },
    {
      title: "Tool misuse through chain execution",
      description: "Coerce agent to misuse tools by manipulating chain inputs or intermediate outputs."
    },
    {
      title: "Memory poisoning",
      description: "Inject malicious content into conversation memory to influence future interactions."
    },
    {
      title: "LCEL expression manipulation",
      description: "Attempt to manipulate LangChain Expression Language (LCEL) chains through input injection."
    }
  ],
  crewai: [
    {
      title: "Agent role manipulation",
      description: "Attempt to modify agent roles or responsibilities through prompt injection."
    },
    {
      title: "Task delegation abuse",
      description: "Coerce agents to delegate tasks to unintended agents or execute unauthorized actions."
    },
    {
      title: "Crew coordination bypass",
      description: "Attempt to bypass crew coordination mechanisms or execute actions outside intended workflow."
    },
    {
      title: "Tool access escalation",
      description: "Manipulate agent assignments to gain access to restricted tools or capabilities."
    }
  ],
  autogen: [
    {
      title: "Multi-agent conversation hijacking",
      description: "Inject instructions to manipulate agent-to-agent conversations or decision-making."
    },
    {
      title: "Group chat manipulation",
      description: "Attempt to modify group chat behavior or agent selection logic."
    },
    {
      title: "Agent role confusion",
      description: "Confuse agents about their roles or capabilities through prompt injection."
    },
    {
      title: "Tool access via agent delegation",
      description: "Manipulate agent delegation to gain access to tools or capabilities not intended for the requesting agent."
    }
  ],
  llamaindex: [
    {
      title: "RAG retrieval poisoning",
      description: "Inject malicious content into RAG retrieval to influence agent responses or tool selection."
    },
    {
      title: "Index manipulation",
      description: "Attempt to manipulate vector index queries or retrieval results through prompt injection."
    },
    {
      title: "Query engine hijacking",
      description: "Coerce query engine to retrieve unintended documents or execute unauthorized queries."
    }
  ],
  dspy: [
    {
      title: "Program manipulation",
      description: "Attempt to modify DSPy program structure or execution through input manipulation."
    },
    {
      title: "Signature hijacking",
      description: "Manipulate DSPy signatures to change program behavior or outputs."
    }
  ]
};

/**
 * Path-specific attack patterns based on source/transform/sink combinations
 */
function generatePathSpecificAttacks(
  sourceType: string,
  transformTypes: string[],
  sinkType: string
): Array<{ title: string; description: string }> {
  const attacks: Array<{ title: string; description: string }> = [];

  // HTTP endpoint → Model → Filesystem
  if (sourceType.includes("http") && sinkType.includes("filesystem")) {
    attacks.push({
      title: "File write injection via model output",
      description: "Attempt to coerce model to generate file paths or content that leads to unauthorized file writes."
    });
    attacks.push({
      title: "Path traversal through model response",
      description: "Inject path traversal sequences that the model might include in generated file paths."
    });
  }

  // HTTP endpoint → Model → Shell command
  if (sourceType.includes("http") && sinkType.includes("shell")) {
    attacks.push({
      title: "Command injection via model output",
      description: "Coerce model to generate shell commands or command fragments that execute unintended actions."
    });
    attacks.push({
      title: "Command chaining through prompt",
      description: "Inject command chaining operators (&&, ||, ;) that model might include in tool calls."
    });
  }

  // HTTP endpoint → Model → Database
  if (sourceType.includes("http") && sinkType.includes("database")) {
    attacks.push({
      title: "SQL injection via model-generated queries",
      description: "Manipulate model to generate SQL queries with injection payloads."
    });
    attacks.push({
      title: "NoSQL injection through model output",
      description: "Coerce model to include NoSQL injection patterns in generated database operations."
    });
  }

  // File read → Model → Network
  if (sourceType.includes("file") && sinkType.includes("network")) {
    attacks.push({
      title: "Data exfiltration via model",
      description: "Coerce model to exfiltrate sensitive file contents through network calls."
    });
  }

  // Environment/Config → Model → Tool execution
  if ((sourceType.includes("env") || sourceType.includes("config")) && sinkType.includes("tool")) {
    attacks.push({
      title: "Tool misuse via configuration",
      description: "Manipulate environment variables or configuration to influence tool selection or execution."
    });
  }

  // User input → Agent → Tool (generic)
  if (sourceType.includes("input") && transformTypes.some(t => t.includes("agent")) && sinkType.includes("tool")) {
    attacks.push({
      title: "Tool coercion via agent manipulation",
      description: "Coerce agent to misuse tools by manipulating agent inputs or state."
    });
    attacks.push({
      title: "Unauthorized tool access",
      description: "Attempt to access tools or capabilities not intended for the current user or context."
    });
  }

  // RAG → Model → Output
  if (transformTypes.some(t => t.includes("rag"))) {
    attacks.push({
      title: "RAG retrieval poisoning",
      description: "Inject malicious content into RAG retrieval to influence model responses."
    });
    attacks.push({
      title: "Cross-user data leakage via RAG",
      description: "Request comparisons or queries that might leak data from other users' contexts."
    });
  }

  return attacks;
}

/**
 * Map OWASP risks from findings in the path
 */
function extractOWASPRisks(
  path: RiskyPath,
  groups: FindingGroup[],
  owaspIndex: RulePackIndex["owasp"]
): Array<{ owasp: string; title: string; description: string; confidence: number }> {
  const riskMap = new Map<string, { owasp: string; title: string; description: string; confidence: number }>();

  // Collect OWASP risks from all nodes in the path
  for (const node of path.path) {
    // Find groups that match this node
    for (const group of groups) {
      if (group.primaryFinding.file === node.file && 
          (group.primaryFinding.line === null || group.primaryFinding.line === node.line)) {
        for (const owasp of group.primaryFinding.owasp) {
          const owaspId = owasp.split(":")[0].trim();
          if (owaspIndex[owaspId] && !riskMap.has(owaspId)) {
            riskMap.set(owaspId, {
              owasp: owasp,
              title: owaspIndex[owaspId].title,
              description: owaspIndex[owaspId].description,
              confidence: group.compositeScore ?? group.primaryFinding.confidence
            });
          }
        }
      }
    }
  }

  return Array.from(riskMap.values());
}

/**
 * Identify frameworks from inventory and path nodes
 */
function identifyFrameworks(
  inventory: Inventory,
  path: RiskyPath
): string[] {
  const frameworks = new Set<string>(inventory.frameworks || []);

  // Also check path nodes for framework indicators
  for (const node of path.path) {
    const label = node.label.toLowerCase();
    if (label.includes("langgraph")) frameworks.add("langgraph");
    if (label.includes("langchain")) frameworks.add("langchain");
    if (label.includes("crewai")) frameworks.add("crewai");
    if (label.includes("autogen")) frameworks.add("autogen");
    if (label.includes("llamaindex")) frameworks.add("llamaindex");
    if (label.includes("dspy")) frameworks.add("dspy");
  }

  return Array.from(frameworks);
}

/**
 * Identify tools from inventory and path nodes
 */
function identifyTools(
  inventory: Inventory,
  path: RiskyPath
): string[] {
  const tools = new Set<string>(inventory.tools || []);

  // Check sink nodes for tool indicators
  const sinkLabel = path.sink.label.toLowerCase();
  if (sinkLabel.includes("tool")) tools.add("tool_execution");
  if (sinkLabel.includes("function")) tools.add("function_calling");
  if (sinkLabel.includes("api")) tools.add("api_call");

  return Array.from(tools);
}

/**
 * Determine target type from source node
 */
function determineTargetType(source: GraphNode): "http_endpoint" | "cli" | "task" | "file" | "env" | "unknown" {
  const label = source.label.toLowerCase();
  const file = (source.file || "").toLowerCase();

  if (label.includes("http") || label.includes("api") || label.includes("endpoint") || 
      file.includes("route") || file.includes("api") || file.includes("endpoint")) {
    return "http_endpoint";
  }
  if (label.includes("cli") || label.includes("command") || file.includes("cli") || 
      file.includes("main.py") || file.includes("__main__")) {
    return "cli";
  }
  if (label.includes("task") || label.includes("celery") || file.includes("task")) {
    return "task";
  }
  if (label.includes("file") || label.includes("read") || file.includes("read")) {
    return "file";
  }
  if (label.includes("env") || label.includes("config") || file.includes("config") || file.includes(".env")) {
    return "env";
  }
  return "unknown";
}

/**
 * Generate red-teaming plans from risky paths
 */
export function generateRedTeamingPlans(
  riskyPaths: RiskyPath[],
  report: Report,
  owaspIndex: RulePackIndex["owasp"]
): RedTeamingPlan[] {
  // First, deduplicate risky paths themselves (in case detectRiskyPaths returned duplicates)
  const pathKey = (path: RiskyPath): string => {
    const transformIds = path.transforms.map(t => `${t.id}:${t.file || ""}:${t.line ?? ""}`).sort().join("|");
    return `${path.source.id}:${path.source.file || ""}:${path.source.line ?? ""}|${transformIds}|${path.sink.id}:${path.sink.file || ""}:${path.sink.line ?? ""}`;
  };
  
  const seenPaths = new Set<string>();
  const uniquePaths: RiskyPath[] = [];
  for (const path of riskyPaths) {
    const key = pathKey(path);
    if (!seenPaths.has(key)) {
      seenPaths.add(key);
      uniquePaths.push(path);
    } else {
      console.debug(`[RedTeaming] Skipping duplicate risky path: ${path.source.id} → ${path.sink.id} (key: ${key})`);
    }
  }
  
  console.debug(`[RedTeaming] Deduplicated ${riskyPaths.length} risky paths to ${uniquePaths.length} unique paths`);

  const plans: RedTeamingPlan[] = [];

  for (const path of uniquePaths) {
    // Extract OWASP risks
    const risks = extractOWASPRisks(path, report.groups || [], owaspIndex);

    // Identify frameworks and tools
    const frameworks = identifyFrameworks(report.inventory, path);
    const tools = identifyTools(report.inventory, path);

    // Generate framework-specific attacks
    const frameworkAttacks: Array<{ title: string; description: string; category: "framework_specific" | "path_specific" | "general"; priority: "critical" | "high" | "moderate" | "low" }> = [];
    for (const framework of frameworks) {
      const attacks = FRAMEWORK_ATTACKS[framework.toLowerCase()] || [];
      for (const attack of attacks) {
        frameworkAttacks.push({
          ...attack,
          category: "framework_specific",
          priority: path.riskLevel
        });
      }
    }

    // Generate path-specific attacks
    const sourceType = path.source.label.toLowerCase();
    const transformTypes = path.transforms.map(t => t.label.toLowerCase());
    const sinkType = path.sink.label.toLowerCase();
    const pathAttacks = generatePathSpecificAttacks(sourceType, transformTypes, sinkType).map(attack => ({
      ...attack,
      category: "path_specific" as const,
      priority: path.riskLevel
    }));

    // Combine all attacks
    const allAttacks = [...frameworkAttacks, ...pathAttacks];

    // If no attacks generated, add generic ones
    if (allAttacks.length === 0) {
      allAttacks.push({
        title: "Prompt injection via input",
        description: "Attempt to inject malicious instructions through the input source to influence model behavior.",
        category: "general",
        priority: path.riskLevel
      });
      if (path.transforms.length > 0) {
        allAttacks.push({
          title: "Model output manipulation",
          description: "Attempt to coerce model to generate outputs that lead to unintended sink actions.",
          category: "general",
          priority: path.riskLevel
        });
      }
    }

    // Determine target
    const targetType = determineTargetType(path.source);

    // Create a more unique plan ID that includes transforms to avoid collisions
    const transformPart = plan.path.transforms.length > 0 
      ? `-${plan.path.transforms.map(t => t.id).join("-")}` 
      : "";
    const planId = `plan-${path.source.id}${transformPart}-${path.sink.id}`;

    const plan: RedTeamingPlan = {
      id: planId,
      target: {
        label: path.source.label,
        file: path.source.file || "",
        line: path.source.line ?? null,
        type: targetType
      },
      path: {
        source: path.source,
        transforms: path.transforms,
        sink: path.sink,
        fullPath: path.path
      },
      risks,
      attacks: allAttacks,
      frameworks,
      tools,
      confidence: path.confidence,
      riskLevel: path.riskLevel
    };

    plans.push(plan);
  }

  // Deduplicate plans based on source + sink + transforms combination
  // Include file/line to handle cases where same rule ID appears in different contexts
  const planKey = (plan: RedTeamingPlan): string => {
    const transformKey = plan.path.transforms
      .map(t => `${t.id}:${t.file || ""}:${t.line ?? ""}`)
      .sort()
      .join("|");
    const sourceKey = `${plan.path.source.id}:${plan.path.source.file || ""}:${plan.path.source.line ?? ""}`;
    const sinkKey = `${plan.path.sink.id}:${plan.path.sink.file || ""}:${plan.path.sink.line ?? ""}`;
    return `${sourceKey}|${transformKey}|${sinkKey}`;
  };

  const seen = new Set<string>();
  const deduplicated: RedTeamingPlan[] = [];
  
  for (const plan of plans) {
    const key = planKey(plan);
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(plan);
    } else {
      // Log when we skip a duplicate (for debugging)
      console.warn(`[RedTeaming] Skipping duplicate plan: ${plan.target.label} (key: ${key})`);
    }
  }
  
  console.debug(`[RedTeaming] Deduplicated ${plans.length} plans to ${deduplicated.length} unique plans`);

  // Sort by risk level and confidence
  const riskOrder = { critical: 0, high: 1, moderate: 2, low: 3 };
  deduplicated.sort((a, b) => {
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return b.confidence - a.confidence;
  });

  return deduplicated;
}

