/**
 * Lightweight call-edge extraction from source code.
 * Uses regex-based heuristics to identify function calls, method invocations,
 * and imports/exports. Can be enhanced with tree-sitter WASM later.
 */

export interface CallEdge {
  from: string; // Caller identifier (function/class name)
  to: string; // Callee identifier (function/class/method name)
  kind: "call" | "import" | "method" | "attribute";
  file: string;
  line: number | null;
  confidence: number; // Heuristic confidence [0-1]
}

export interface CallGraph {
  edges: CallEdge[];
  functions: Map<string, { file: string; line: number | null }>; // func name -> location
  imports: Map<string, { file: string; from: string }>; // imported name -> location
}

const JS_TS_PATTERNS = {
  // Function declarations: function name(...) or const name = (...) =>
  functionDecl: /(?:function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*\(|let\s+(\w+)\s*=\s*\(|var\s+(\w+)\s*=\s*\(|(\w+)\s*:\s*\([^)]*\)\s*=>)/g,
  // Method calls: obj.method(...) or obj?.method(...)
  methodCall: /(\w+)\s*(?:\.|\?\.)\s*(\w+)\s*\(/g,
  // Function calls: name(...)
  functionCall: /(\b\w+)\s*\(/g,
  // Imports: import ... from 'module' or import ... from "module"
  importStmt: /import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
  // require: require('module') or require("module")
  requireStmt: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // Dynamic imports: await import('module')
  dynamicImport: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
};

const PYTHON_PATTERNS = {
  // Function definitions: def name(...)
  functionDecl: /def\s+(\w+)\s*\(/g,
  // Class definitions: class Name(...)
  classDecl: /class\s+(\w+)\s*(?:\([^)]+\))?\s*:/g,
  // Method calls: obj.method(...) or obj().method(...)
  methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/g,
  // Function calls: name(...)
  functionCall: /(\b\w+)\s*\(/g,
  // Imports: from module import name, ... or import module
  importFrom: /from\s+([\w.]+)\s+import\s+([\w,\s]+)/g,
  importStmt: /import\s+([\w.]+)(?:\s+as\s+(\w+))?/g
};

function getLineNumber(content: string, index: number): number | null {
  if (index < 0) return null;
  const sub = content.slice(0, index);
  return sub.split(/\r?\n/).length;
}

/**
 * Extract call edges from JavaScript/TypeScript source code.
 */
export function extractJSCallEdges(file: string, content: string): CallGraph {
  const edges: CallEdge[] = [];
  const functions = new Map<string, { file: string; line: number | null }>();
  const imports = new Map<string, { file: string; from: string }>();

  // Extract function declarations
  let match;
  while ((match = JS_TS_PATTERNS.functionDecl.exec(content)) !== null) {
    const name = match[1] || match[2] || match[3] || match[4] || match[5];
    if (name) {
      const line = getLineNumber(content, match.index);
      functions.set(name, { file, line });
    }
  }

  // Extract imports
  JS_TS_PATTERNS.importStmt.lastIndex = 0;
  while ((match = JS_TS_PATTERNS.importStmt.exec(content)) !== null) {
    const named = match[1]; // { name1, name2 }
    const namespace = match[2]; // * as name
    const default_ = match[3]; // default
    const module = match[4];
    const line = getLineNumber(content, match.index);

    if (named) {
      // Extract individual names from { name1, name2 }
      const names = named.split(',').map(n => n.trim().split(/\s+as\s+/)[0]);
      for (const name of names) {
        imports.set(name, { file, from: module });
        edges.push({
          from: name,
          to: module,
          kind: "import",
          file,
          line,
          confidence: 0.9
        });
      }
    } else if (namespace) {
      imports.set(namespace, { file, from: module });
      edges.push({
        from: namespace,
        to: module,
        kind: "import",
        file,
        line,
        confidence: 0.9
      });
    } else if (default_) {
      imports.set(default_, { file, from: module });
      edges.push({
        from: default_,
        to: module,
        kind: "import",
        file,
        line,
        confidence: 0.9
      });
    }
  }

  // Extract method calls (obj.method(...))
  JS_TS_PATTERNS.methodCall.lastIndex = 0;
  while ((match = JS_TS_PATTERNS.methodCall.exec(content)) !== null) {
    const obj = match[1];
    const method = match[2];
    const line = getLineNumber(content, match.index);
    
    // Skip known non-AI patterns (console.log, Math.max, etc.)
    if (obj === "console" || obj === "Math" || obj === "JSON" || obj === "Array" || obj === "Object") {
      continue;
    }

    edges.push({
      from: obj,
      to: method,
      kind: "method",
      file,
      line,
      confidence: 0.7
    });
  }

  // Extract function calls (name(...))
  // Focus on known AI/agent patterns
  const aiCallPatterns = [
    /(?:openai|anthropic|langchain|langgraph|crewai|autogen)\.(\w+)\s*\(/gi,
    /(?:client|agent|graph|chain|tool)\.(\w+)\s*\(/gi,
    /(\w+)(?:\.invoke|\.stream|\.run|\.execute|\.call)\s*\(/gi
  ];

  for (const pattern of aiCallPatterns) {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      const callee = match[1] || match[0].split('.')[0];
      const line = getLineNumber(content, match.index);
      
      edges.push({
        from: "caller", // Will be refined with context later
        to: callee,
        kind: "call",
        file,
        line,
        confidence: 0.8
      });
    }
  }

  return { edges, functions, imports };
}

/**
 * Extract call edges from Python source code.
 */
export function extractPythonCallEdges(file: string, content: string): CallGraph {
  const edges: CallEdge[] = [];
  const functions = new Map<string, { file: string; line: number | null }>();
  const imports = new Map<string, { file: string; from: string }>();

  // Extract function definitions
  let match;
  while ((match = PYTHON_PATTERNS.functionDecl.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    functions.set(name, { file, line });
  }

  // Extract class definitions
  PYTHON_PATTERNS.classDecl.lastIndex = 0;
  while ((match = PYTHON_PATTERNS.classDecl.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    functions.set(name, { file, line });
  }

  // Extract imports: from module import name1, name2
  while ((match = PYTHON_PATTERNS.importFrom.exec(content)) !== null) {
    const module = match[1];
    const names = match[2].split(',').map(n => n.trim().split(/\s+as\s+/)[0]);
    const line = getLineNumber(content, match.index);

    for (const name of names) {
      imports.set(name, { file, from: module });
      edges.push({
        from: name,
        to: module,
        kind: "import",
        file,
        line,
        confidence: 0.9
      });
    }
  }

  // Extract imports: import module [as alias]
  PYTHON_PATTERNS.importStmt.lastIndex = 0;
  while ((match = PYTHON_PATTERNS.importStmt.exec(content)) !== null) {
    const module = match[1];
    const alias = match[2] || module.split('.').pop() || module;
    const line = getLineNumber(content, match.index);

    imports.set(alias, { file, from: module });
    edges.push({
      from: alias,
      to: module,
      kind: "import",
      file,
      line,
      confidence: 0.9
    });
  }

  // Extract method calls (obj.method(...))
  PYTHON_PATTERNS.methodCall.lastIndex = 0;
  while ((match = PYTHON_PATTERNS.methodCall.exec(content)) !== null) {
    const obj = match[1];
    const method = match[2];
    const line = getLineNumber(content, match.index);

    // Skip known non-AI patterns
    if (obj === "print" || obj === "len" || obj === "str" || obj === "int" || obj === "dict" || obj === "list") {
      continue;
    }

    edges.push({
      from: obj,
      to: method,
      kind: "method",
      file,
      line,
      confidence: 0.7
    });
  }

  // Extract AI/agent-specific calls
  const aiCallPatterns = [
    /(?:OpenAI|Anthropic|LangChain|LangGraph|CrewAI|AutoGen)\(/gi,
    /(?:client|agent|graph|chain|tool)\.(\w+)\s*\(/gi,
    /\.(invoke|stream|run|execute|call)\s*\(/gi,
    /(?:@tool|@agent|@chain)/gi
  ];

  for (const pattern of aiCallPatterns) {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      const callee = match[1] || match[0];
      const line = getLineNumber(content, match.index);

      edges.push({
        from: "caller",
        to: callee,
        kind: "call",
        file,
        line,
        confidence: 0.8
      });
    }
  }

  return { edges, functions, imports };
}

/**
 * Extract call edges from source code based on file extension.
 */
export function extractCallEdges(file: string, content: string): CallGraph {
  const ext = file.split('.').pop()?.toLowerCase();
  
  if (ext === "js" || ext === "jsx" || ext === "ts" || ext === "tsx") {
    return extractJSCallEdges(file, content);
  } else if (ext === "py") {
    return extractPythonCallEdges(file, content);
  }

  // Return empty graph for unsupported files
  return { edges: [], functions: new Map(), imports: new Map() };
}

