# AI Fingerprint Expansion & Agent Reachability Plan
### *A Coaching Playbook for Upgrading HawkAI*

**Author:** ChatGPT  
**Audience:** Cursor (your engineering team)  
**Goal:** Build comprehensive, low-noise, high-confidence detection of AI components, agent frameworks, model usage, and reachable agent workflows in GitHub repositories scanned by HawkAI.

---

# 1. OBJECTIVE

Upgrade HawkAI’s scanning engine so it can:

1. **Reliably detect AI components** (SDKs, models, frameworks, endpoints, local runtimes)  
2. **Recognize agent frameworks** (LangGraph, LangChain, CrewAI, AutoGen, LlamaIndex, DSPy, etc.)  
3. **Identify agentic patterns** (control loops, tool usage, multi-step workflows)  
4. **Aggregate multi-signal confidence** for higher precision  
5. **Build a light-weight reachability graph** from entrypoints → agent sinks  
6. **Generate auto-red-teaming plans** based on findings  

---

# 2. HIGH-LEVEL STRATEGY

Like a football coaching plan:

- **Add more receivers:** massively expand detection rules with robust AI fingerprints  
- **Improve passing accuracy:** create multi-signal scoring so one weak hint doesn’t trigger a false positive  
- **Map the field:** build a minimal but meaningful reachability graph  
- **Call smart plays:** auto-generate red-teaming plans using the discovered structure  
- **Keep the defense tight:** avoid noise by using structured file/type filters  

---

# 3. WORK UNITS FOR CURSOR (DO THESE IN ORDER)

## 3.1 Expand AI fingerprints

Add new YAML rules for:

### A. Major SDKs
- OpenAI  
- Anthropic  
- Google Gemini  
- Azure OpenAI  
- AWS Bedrock  
- Mistral  
- Cohere  
- Groq  
- LM Studio  
- Ollama  
- vLLM  
- llama.cpp  

### B. Agent Frameworks
- LangGraph  
- LangChain  
- AutoGen  
- CrewAI  
- Semantic Kernel  
- LlamaIndex  
- DSPy  
- Haystack  
- LangChain Expression Language (LCEL)

### C. Model Name Fingerprinting
Match patterns for:
- gpt-4o, gpt-4.1, gpt-4o-mini, gpt-3.5-turbo  
- claude-3.5-sonnet, claude-3-opus  
- gemini-1.5-pro, gemini-exp-*  
- mistral-large-latest  
- mixtral-8x7b  

### D. Endpoint Fingerprinting
Flag raw API usage:
- /v1/chat/completions  
- /v1/messages  
- /v1/models  
- /v1beta/models  
- Bedrock InvokeModel + InvokeModelWithResponseStream  
- "type": "function" (OpenAI function calling)  

---

## 3.2 Add Agentic Pattern Rules

### A. LangGraph-specific patterns

(from\s+langgraph\.graph\s+import\s+StateGraph)  
(import\s+langgraph)  
(StateGraph\()  
(\.add_node\()  
(\.add_edge\()  
(\.compile\()  
(\.(invoke|stream)\()

### B. Generic Agent Tools
Detect across frameworks:

- @tool  
- Tool(  
- StructuredTool(  
- tools=[...]  
- "type": "function"  

### C. Autonomous Control Loops

Python, JS, TS:

- while True: followed by agent.step, graph.invoke, workflow.run  
- For-loops calling agent graph functions  
- Async variants (await agent.step())  

---

## 3.3 Implement Multi-Signal Confidence Scoring

### Confidence tiers:

Signals | Confidence | Meaning
--------|------------|---------
1 fingerprint | low | “AI probably present”
2 distinct fingerprints | medium | “AI usage confirmed”
≥3 fingerprints | high | “Strong confirmation & likely active use”

Cursor should merge fingerprints belonging to the same underlying technology.

---

## 3.4 Expand File Filters

Cursor should scan:

- *.py, *.ts, *.js, *.go, *.rs  
- pyproject.toml, poetry.lock, uv.lock, package.json  
- .env, .env.*  
- docker-compose.yml, Dockerfile  
- helm/**/values*.yaml  

Cursor should exclude:

- node_modules  
- .venv  
- .pytest_cache  
- __pycache__  

---

## 3.5 Build Minimal Reachability Graph

### Identify entrypoints:
- FastAPI: @router.get, @app.post  
- Express: app.get("/"), router.post  
- CLI: if __name__ == "__main__"  
- Celery tasks / cron  

### Identify AI sinks:
Search for:

- client.chat.completions.create  
- graph.invoke  
- model.generate_content  
- agent.run  
- llm(  

### Construct the graph:
- Match function definitions  
- Match function calls  
- Link by name to build:

entrypoint → service → agent_sink

A rough graph is fine — MVP-level static analysis.

### Output format:
Store adjacency list:

{
  "/api/portfolio": ["services/portfolio_agent.py"],
  "services/portfolio_agent.py": ["graph.py:invoke"]
}

---

## 3.6 Auto-Generate Red-Teaming Plans

For each graph path:

### Inputs:
- Detected AI tech  
- Detected agent tools  
- Agent framework type  
- OWASP LLM Top 10 risks  
- Entry → sink path  

### Output Example:

Target: GET /api/portfolio

Path:
routes/portfolio.py → services/portfolio_agent.py → graph.py (StateGraph.invoke)

Risks:
- LLM02 Prompt Injection
- LLM05 Data Leakage
- LLM06 Overreliance

Suggested Attacks:
- Coerce agent to misuse tools
- Attempt metadata poisoning in LangGraph nodes
- Attempt branching manipulation with malformed inputs
- Request cross-user comparisons to test for data leakage

---

# 4. DEFINITION OF DONE

Cursor is finished when:

### AI Fingerprints
- LangGraph reliably detected  
- LangChain reliably detected  
- All major AI SDKs covered  
- Model & endpoint fingerprints added  
- Local runtimes added  

### Agentic Patterns
- Tool usage detected  
- Autonomous loops detected  
- Generic agent frameworks detected  

### Analysis Engine
- Multi-signal scoring implemented  
- Reachability graph generated  
- Entry → agent sink paths shown  

### Report UX
- Red-teaming plan autogenerated  

---

# 5. FINAL COACHING MESSAGE

Cursor — your mission is clear:

**Turn HawkAI into the most thorough free AI component + agent risk scanner on GitHub.**

Aim for complete AI surface coverage, strong signals, smart graphing, and practical attack guidance.

Deliver the win.
