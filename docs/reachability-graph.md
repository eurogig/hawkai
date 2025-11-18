# Reachability Graph

This document explains HawkAI's reachability graph feature, which models data flow from untrusted input sources through AI/agent processing to potentially dangerous sink operations. The graph helps identify risky paths where user input could be processed by models/agents and then executed as tools without proper validation.

## Overview

The reachability graph extends traditional finding detection by:
1. **Building a graph** from grouped findings and code call edges
2. **Propagating confidence** along paths to score edge weights
3. **Detecting risky paths** from sources (untrusted input) → transforms (models/agents) → sinks (tool executions)

## Graph Schema

### Nodes

Nodes represent findings or code entities:
- **id**: Stable identifier (ruleId|file|line)
- **kind**: `finding` (from detection rules)
- **label**: Rule ID or entity name
- **file**: File path
- **line**: Line number (optional)
- **severity**: Finding severity (low, moderate, high, critical)
- **confidence**: Individual finding confidence [0-1]
- **compositeScore**: Multi-signal composite score [0-1]
- **category**: Finding category

### Edges

Edges represent relationships between nodes:
- **id**: Stable identifier
- **kind**: One of:
  - `related`: Finding-to-finding relationships (from grouping)
  - `calls`: Function/method calls (extracted from code)
  - `uses_model`: Imports/calls to AI models (OpenAI, Anthropic, etc.)
  - `uses_tool`: Tool invocations (agent tools, function calling)
  - `uses_endpoint`: API endpoint usage
  - `data_flow`: Data flow relationships (best-effort)
- **from**: Source node ID
- **to**: Target node ID
- **weight**: Confidence/score [0-1] (after propagation)
- **label**: Optional edge label

### Graph Structure

```typescript
interface ReachabilityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
  };
}
```

## Graph Construction

The graph is built in three stages:

### 1. Coarse Graph (from Findings)

Initial graph built from grouped findings:
- Creates a node for each finding (primary and related)
- Adds `related` edges from primary → related findings in each group
- Annotates nodes with severity, confidence, compositeScore

### 2. Call-Edge Extraction

Enriches the graph with code-level call edges:
- Extracts function calls, method invocations, imports from source files
- Uses lightweight regex-based patterns for JS/TS and Python
- Maps call edges to finding nodes based on file/line proximity
- Classifies edge kinds based on call patterns (e.g., AI imports → `uses_model`)

**Performance caps:**
- Max 200 files processed
- Max 100 call edges per file
- Max 5000 total call edges

### 3. Confidence Propagation

Propagates confidence along paths:
- Calculates edge weights from source/target node confidence (geometric mean)
- Applies boosts for AI-specific edges (`uses_model`, `uses_tool`, `uses_endpoint`)
- Finds paths from high-confidence nodes (≥0.7) and applies decay (15% per hop)
- Updates edge weights: 60% base weight + 40% path score

**Performance caps:**
- Max 100 high-confidence nodes for propagation
- Max path length: 5 hops
- Decay rate: 0.85 per hop

## Risky Path Detection

Detects paths that represent security risks: **untrusted input → model/agent → tool execution**.

### Source Nodes (Inputs)

Nodes that receive untrusted input:
- **User input**: HTTP params, CLI args, stdin, readline, `input()`
- **File reads**: `readFile`, `open()`, file I/O operations
- **Environment/config**: `process.env`, `os.getenv`, dotenv, config files
- **Network inputs**: HTTP request body/query/params, fetch responses
- **Tools that receive input**: Tools can be sources if they receive input from the above patterns

### Transform Nodes (Processing)

Nodes that process data through AI/agents:
- **LLM calls**: `chat.completions`, `completions.create`, `invoke`, `stream`
- **Agent frameworks**: LangGraph, LangChain, CrewAI, AutoGen agents
- **RAG retrieval**: Vector search, retrieval chains, embeddings
- **Model usage**: Direct model/endpoint calls (OpenAI, Anthropic, etc.)

**Important**: Tools are NOT transforms. Tools are sources (when receiving input) or sinks (when executing), but not transforms (which are model/agent processing).

### Sink Nodes (Executions)

Nodes that execute potentially dangerous operations:
- **Filesystem**: `writeFile`, file writes, `open('w')`, `os.system`, `subprocess`
- **Tool executions**: Agent tools, function calling, tool invocations
- **Network calls**: `fetch`, `requests.post`, `http.post`, SMTP, send/publish
- **Database**: `execute`, `query`, `commit`, insert/update/delete
- **Shell/system**: `system`, `exec`, `spawn`, shell commands

### Tool→Model→Tool Pattern

A critical pattern to detect is: **Tool (source) → Model/Agent (transform) → Tool (sink)**

**Example:**
1. Tool receives user input (e.g., HTTP request, CLI arg)
2. Input is passed to an LLM/agent for processing
3. Agent's output is executed by another tool (e.g., file write, shell command)

This pattern is risky because:
- User input flows into AI processing (prompt injection risk)
- AI output flows into tool execution (code injection, privilege escalation risk)
- No validation may exist between steps

**Detection logic:**
- Tools can be **sources** if they receive input from user/HTTP/env/file sources
- Tools can be **sinks** if they execute operations (filesystem, shell, network, DB)
- Tools are **never transforms** (transforms are model/agent calls only)
- Self-loops are prevented (same node cannot be both source and sink)
- Paths must have at least one transform between source and sink

### Path Scoring

Risky paths are scored and prioritized:

1. **Path confidence**: Product of node confidences × length decay (0.9^length)
2. **Risk levels**:
   - `critical`: confidence ≥ 0.8
   - `high`: confidence ≥ 0.6
   - `moderate`: confidence ≥ 0.4
   - `low`: confidence < 0.4

3. **Deduplication**: Top path per source→sink pair (highest confidence)
4. **Limits**: Top 50 paths returned, sorted by confidence

**Performance caps:**
- Max 200 source nodes considered
- Max 200 sink nodes considered
- Max path length: 6 hops
- Prioritizes high-confidence nodes first

## Red-Teaming Plans

Phase 4 extends the reachability graph with **auto-generated red-teaming plans** that provide actionable attack scenarios based on detected risky paths, frameworks, and OWASP LLM Top 10 risks.

### Plan Generation

For each risky path detected, a red-teaming plan is automatically generated that includes:

1. **Target**: Entry point (HTTP endpoint, CLI, task, file, env/config)
2. **Path**: Full source → transform → sink path
3. **OWASP Risks**: Mapped from findings in the path
4. **Frameworks**: Detected agent frameworks (LangGraph, LangChain, CrewAI, etc.)
5. **Tools**: Detected tools and capabilities
6. **Attacks**: Framework-specific and path-specific attack suggestions

### Framework-Specific Attacks

Plans include attacks tailored to detected frameworks:

- **LangGraph**: Metadata poisoning, branching manipulation, state graph manipulation
- **LangChain**: Chain manipulation, tool misuse, memory poisoning, LCEL manipulation
- **CrewAI**: Agent role manipulation, task delegation abuse, crew coordination bypass
- **AutoGen**: Multi-agent conversation hijacking, group chat manipulation
- **LlamaIndex**: RAG retrieval poisoning, index manipulation
- **DSPy**: Program manipulation, signature hijacking

### Path-Specific Attacks

Attacks are also generated based on source/transform/sink combinations:

- **HTTP → Model → Filesystem**: File write injection, path traversal
- **HTTP → Model → Shell**: Command injection, command chaining
- **HTTP → Model → Database**: SQL/NoSQL injection via model output
- **File → Model → Network**: Data exfiltration
- **Env/Config → Model → Tool**: Tool misuse via configuration
- **User Input → Agent → Tool**: Tool coercion, unauthorized tool access
- **RAG → Model → Output**: RAG retrieval poisoning, cross-user data leakage

### Plan Structure

```typescript
interface RedTeamingPlan {
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
```

### Usage

#### CLI

Red-teaming plans are included in graph output:

```bash
# JSON output with plans
npm run scan -- <repo-url> --graph json

# Plans are displayed after risky paths
npm run scan -- <repo-url> --graph json
```

#### UI

Red-teaming plans appear in the report after findings, showing:
- Target entry point and type
- Full path visualization
- OWASP risks mapped
- Detected frameworks and tools
- Prioritized attack suggestions

### Testing

Run red-teaming plan tests:

```bash
npm run test:red-teaming
```

Tests validate:
- Plan generation from risky paths
- Framework detection
- Attack suggestion generation
- OWASP risk mapping
- Plan structure validation

## Output Formats

### JSON

Full graph structure with nodes, edges, and risky paths:

```json
{
  "graph": {
    "nodes": [...],
    "edges": [...],
    "stats": {...}
  },
  "riskyPaths": [
    {
      "source": {...},
      "transforms": [...],
      "sink": {...},
      "path": [...],
      "confidence": 0.85,
      "riskLevel": "critical"
    }
  ],
  "redTeamingPlans": [
    {
      "id": "plan-...",
      "target": {
        "label": "GET /api/portfolio",
        "file": "routes/portfolio.py",
        "line": 10,
        "type": "http_endpoint"
      },
      "path": {...},
      "risks": [
        {
          "owasp": "LLM02: Data Leakage",
          "title": "Data Leakage",
          "description": "...",
          "confidence": 0.8
        }
      ],
      "attacks": [
        {
          "title": "Metadata poisoning in LangGraph nodes",
          "description": "Attempt to inject malicious metadata...",
          "category": "framework_specific",
          "priority": "critical"
        }
      ],
      "frameworks": ["langgraph"],
      "tools": ["tool_execution"],
      "confidence": 0.85,
      "riskLevel": "critical"
    }
  ]
}
```

### Graphviz DOT

For visualization with Graphviz:

```bash
npm run scan -- <repo-url> --graph dot > graph.dot
dot -Tsvg graph.dot > graph.svg
```

### Mermaid

For markdown/git rendering:

```bash
npm run scan -- <repo-url> --graph mermaid > graph.mmd
```

Mermaid diagrams can be embedded in Markdown:

\`\`\`mermaid
flowchart LR
  N0["AG-TOOL-CLASS\nfile.py:10"] -->|related| N1["AI-FP-OPENAI-CLIENT\nfile.py:5"]
  ...
\`\`\`

## Usage

### CLI

Generate graph with risky paths:

```bash
# JSON output
npm run scan -- <repo-url> --graph json

# Mermaid diagram
npm run scan -- <repo-url> --graph mermaid

# Graph only (no scan report)
npm run scan -- <repo-url> --graph mermaid --graph-only
```

### UI (Future)

The reachability graph will be available in the UI as an interactive tab:
- Visualize graph with Cytoscape.js
- Filter by risk level, source type, sink type
- Click nodes to view details and jump to source code
- Highlight risky paths with highest confidence

## Interpretation

### Reading Risky Paths

Each risky path shows:
1. **Source**: Where untrusted input enters the system
2. **Transforms**: AI/agent processing nodes in the path
3. **Sink**: Where potentially dangerous execution occurs
4. **Path**: Full sequence of nodes from source to sink
5. **Confidence**: Combined confidence score [0-1]
6. **Risk Level**: critical/high/moderate/low

### Priority

Focus on:
1. **Critical paths** (confidence ≥ 0.8) with tool→model→tool pattern
2. **High-confidence sinks** (filesystem, shell, network writes)
3. **Paths with multiple transforms** (chained agent calls increase risk)

### Validation

When a risky path is detected:
1. **Trace the path** through source code
2. **Check for input validation** at source boundaries
3. **Verify output sanitization** before tool execution
4. **Look for missing guardrails** between model and tool
5. **Consider prompt injection risks** if user input reaches models

### Limitations

- **Regex-based extraction**: Limited precision compared to full AST parsing
- **Best-effort data flow**: May miss indirect flows through variables/objects
- **Static analysis**: Cannot detect runtime-only paths
- **False positives**: May flag benign paths that have proper validation
- **Performance caps**: Large repos may not analyze all files

Future enhancements:
- Tree-sitter WASM for more accurate parsing
- Improved data flow analysis
- Runtime tracing integration

## Testing

### Graph Tests

Run graph tests:

```bash
npm run test:graph
```

Tests validate:
- Graph construction from findings
- Call-edge extraction
- Confidence propagation
- Risky path detection
- Tool→model→tool pattern detection

Results saved to `tests/graph-test-results.json` for regression testing.

### Red-Teaming Plan Tests

Run red-teaming plan tests:

```bash
npm run test:red-teaming
```

Tests validate:
- Plan generation from risky paths
- Framework detection and mapping
- Attack suggestion generation (framework-specific and path-specific)
- OWASP risk mapping from findings
- Plan structure validation
- Attack prioritization

