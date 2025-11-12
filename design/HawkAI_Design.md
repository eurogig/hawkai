# HawkAI – GitHub Pages In‑Browser Repo Scanner
**Version:** 0.1 (MVP)  
**Owner:** Steve Giguere  
**Working Name:** HawkAI (a.k.a. “HawkAI Scan”)  
**Hosting:** GitHub Pages (static)  
**Mode:** 100% client‑side; public repos only

---

## 1) Overview
HawkAI is a free, in‑browser scanner that analyzes a public GitHub repository URL and generates a downloadable risk report. The report inventories **AI usage** (SDKs, models, agent frameworks, MCP descriptors), detects **agentic design patterns**, and maps findings to **OWASP LLM Top 10** and related categories. All scanning happens **locally in the user’s browser**; source code is not uploaded to any server.

**Pitch:** “Paste a GitHub repo URL. HawkAI fetches the repo archive, scans it locally, and renders a beautiful risk report you can export to Markdown/PDF.”

---

## 2) Goals & Non‑Goals
### Goals
- Zero‑cost hosting and execution (GitHub Pages + browser JS).
- Scan public repos using GitHub codeload ZIPs; no authentication required.
- Detect presence of AI/agentic code and risky patterns; map to OWASP LLM Top 10.
- Produce an attractive, filterable report with export (Markdown and PDF).
- Respect privacy: code never leaves the browser.

### Non‑Goals (MVP)
- Private repo scanning (defer to future local CLI).
- Full SAST; we’re pattern/rule based (string/heuristic with light AST optional).
- Real‑time server backend, queues, or databases.
- Authored “advice” beyond concise remediation notes.

---

## 3) User Stories
1. As a user, I can paste a GitHub repo URL and click **Scan** to get a risk report.
2. As a user, I can see **progress** (downloading, unzipping, files processed).
3. As a user, I can view findings grouped by **severity** and **OWASP category** with **evidence**.
4. As a user, I can see an **AI Inventory** (SDKs/models/agents/MCP/tools detected).
5. As a user, I can **download** the report as **Markdown** or **PDF**.
6. As a user, I can **filter/search** findings and copy permalinks (hash anchors).

---

## 4) Architecture (MVP – Option 1: 100% Client‑Side)
**Stack:** Vanilla JS (or Vite + TypeScript), TailwindCSS, `fflate` (ZIP), optional `marked` and `html2pdf.js`.  
**Flow:**
1. Parse GitHub URL → extract `{owner, repo, branch?}`.
2. Fetch default branch via GitHub API (optional) or assume `main` and fall back to `master`.
3. Download ZIP from `https://codeload.github.com/<owner>/<repo>/zip/refs/heads/<branch>`.
4. Unzip in browser with `fflate` (stream or sync for MVP).
5. Iterate files, skip binaries by extension/heuristic.
6. Apply **Rule Engine** (rule packs) to filenames + contents.
7. Aggregate findings, compute **risk score**, render **Report View**.
8. Export:  
   - **Markdown:** Serialize findings and inventory into `.md`.  
   - **PDF:** Use `html2pdf.js` on the report DOM.

**Performance controls:**
- Limit scan to ≤ 30k files or ≤ 100 MB unzipped (configurable).  
- Use a **Web Worker** to prevent UI blocking for large repos.  
- Early‑exit on huge vendor directories (`node_modules/`, `dist/`, `build/`) unless explicitly enabled.

---

## 5) Rules & Data Models
### 5.1 Rule Pack Format (YAML/JSON)
Each rule has: `id`, `title`, `severity`, `category`, `owasp`, `fileGlobs`, `contentRegex`, `evidenceHint`, `remediation`, `confidence`.

```yaml
# rules/ai_fingerprints.yml
- id: AI-FP-OPENAI-IMPORT
  title: "OpenAI SDK import detected"
  severity: "moderate"
  category: "AI Usage"
  owasp: ["LLM09: Model Misuse", "LLM10: Supply Chain"]
  fileGlobs: ["**/*.ts", "**/*.js", "**/*.py"]
  contentRegex: "(from\\s+['\\\"]openai['\\\"]|require\\(['\\\"]openai['\\\"]\\))"
  evidenceHint: "openai import"
  remediation: "Inventory and govern model usage. Ensure keys are secret-managed & usage policies enforced."
  confidence: 0.9
```

```yaml
# rules/agentic_patterns.yml
- id: AG-LOOP-AUTOEXEC
  title: "Autonomous agent loop with automatic tool execution"
  severity: "high"
  category: "Agentic Design"
  owasp: ["LLM01: Prompt Injection", "LLM05: Excessive Agency"]
  fileGlobs: ["**/*.{ts,js,py,go,rs}"]
  contentRegex: "(while\\s*\\(true\\)|for\\s*\\(;;\\))"
  evidenceHint: "unbounded loop around tool calls"
  remediation: "Gate autonomous actions behind policy checks, limits, and human‑in‑the‑loop approvals."
  confidence: 0.7
```

```yaml
# rules/secrets.yml
- id: SEC-KEY-OPENAI
  title: "Possible OpenAI API key"
  severity: "critical"
  category: "Secrets"
  owasp: ["LLM06: Sensitive Information Disclosure"]
  fileGlobs: ["**/*"]
  contentRegex: "sk-(live|test)-[A-Za-z0-9]{20,}"
  evidenceHint: "API key pattern"
  remediation: "Rotate the key, purge history, and store secrets in env vars or vault."
  confidence: 0.6
```

> Store rule packs under `/rules/*.yml`. Load and compile to `RegExp` at runtime.

### 5.2 Finding Object (JSON)
```json
{
  "id": "AI-FP-OPENAI-IMPORT",
  "severity": "moderate",
  "category": "AI Usage",
  "owasp": ["LLM09", "LLM10"],
  "file": "src/ai/client.ts",
  "line": 8,
  "evidence": "import OpenAI from 'openai'",
  "remediation": "Inventory and govern model usage...",
  "confidence": 0.9
}
```

### 5.3 Report Schema
```json
{
  "repo": "owner/repo",
  "branch": "main",
  "scannedAt": "2025-11-11T14:00:00Z",
  "stats": { "files": 1242, "scanned": 980, "skipped": 262, "durationMs": 7421 },
  "inventory": {
    "sdks": ["openai", "anthropic"],
    "models": ["gpt-4o", "claude-3-sonnet"],
    "frameworks": ["langchain", "mcp"],
    "tools": ["web-search", "filesystem"]
  },
  "findings": [ /* Finding[] */ ],
  "score": { "overall": 62, "riskLevel": "Medium", "weights": { "critical": 5, "high": 3, "moderate": 2, "low": 1 } }
}
```

---

## 6) Risk Scoring (MVP)
- Map severity → weights (e.g., Critical 5, High 3, Moderate 2, Low 1).  
- Score = `Σ(weights)` normalized against file count or a cap.  
- Bucket into **Low / Medium / High / Critical** with a color scale.  
- Show “Top 3 drivers of risk” and “What would reduce your score”.

---

## 7) UI/UX Requirements
### Pages/Sections
1. **Home/Scan Panel**
   - URL input (validate GitHub URL), Branch (optional), **Scan** button.
   - Helper text: examples, privacy note (“code stays in your browser”).

2. **Progress View**
   - Steps: Resolve branch → Download ZIP → Unzip → Scan → Report.
   - Progress bar, file counter, elapsed time.

3. **Report View**
   - **Header Summary**: Repo, branch, time, risk score pill, quick stats.
   - **Inventory Cards**: SDKs, models, frameworks, tools.
   - **Findings Table**: columns: Severity, Category, File:Line, Rule, Evidence (collapsible), OWASP, Remediation.
   - Filters: Severity, Category, OWASP; Search box.
   - **Export**: Markdown, PDF.
   - **Copy permalink** for each finding (hash anchor).

### Visual Style
- **TailwindCSS** + minimal, clean “security dashboard” look.  
- Color tokens for severities (Critical/High/Moderate/Low).  
- Hawk eye glyph + subtle radar animation during scanning.  
- Dark mode first; toggle available.

### Accessibility
- Semantic HTML, focus states, `aria-live` for progress, keyboard nav, contrast‑safe palette.

---

## 8) Key Modules
- `url.ts` – parse/validate GitHub URLs.
- `github.ts` – default branch resolution (optional), fetch ZIP.
- `unzip.ts` – `fflate` helpers, binary skip heuristic.
- `rules.ts` – load/compile rule packs; evaluator.
- `scanner.ts` – walk files, apply rules, collect findings.
- `score.ts` – severity weighting and overall score.
- `report.tsx` – render report; export to Markdown/PDF.
- `worker.ts` – Web Worker for scanning.
- `ui/*` – components (Input, Progress, Cards, Table, Filters, Toasts).

---

## 9) Performance & Limits
- Skip `node_modules/`, `dist/`, `build/`, `target/`, `.git/`, large binaries (`.png`, `.jpg`, `.pdf`, `.zip`, `.mp4`, etc.).
- Cap file count and uncompressed size (display override warning).
- Stream unzip where possible; chunk scanning to yield to the event loop.
- Web Worker isolates CPU‑heavy scanning from UI thread.

---

## 10) Security & Privacy
- No server; code never leaves the browser.  
- Do not store repo content; store only **ephemeral** scan state in memory.  
- If adding share features (future), require explicit opt‑in (e.g., publish to Gist).  
- Sanitize evidence snippets in UI (escape HTML).  
- Secrets detection: never render full keys; mask with `****` beyond 4–6 visible chars.

---

## 11) Rate Limits & Error Handling
- Unauthenticated GitHub API limit ~60 req/hour/IP (MVP uses codeload ZIP which is not API).  
- Handle: 404 (repo/branch), network errors, huge archives, corrupted ZIP.
- Friendly error to user with remediation (check URL, branch, privacy, size).

---

## 12) Tech Choices
- **Build:** Vite + TypeScript (fast, dev‑friendly) – or vanilla JS MVP.
- **UI:** TailwindCSS.
- **ZIP:** `fflate`.
- **YAML:** `yaml` (to parse rule packs).
- **Export:** Markdown serializer; `html2pdf.js` for PDF.
- **State:** Simple store (signals or minimal Redux/Zustand optional).

---

## 13) Directory Structure (Pages‑ready)
```
/ (repo root)
├─ index.html
├─ src/
│  ├─ main.ts
│  ├─ ui/
│  │  ├─ App.tsx
│  │  ├─ ScanForm.tsx
│  │  ├─ Progress.tsx
│  │  ├─ Report.tsx
│  │  ├─ Inventory.tsx
│  │  └─ FindingsTable.tsx
│  ├─ core/
│  │  ├─ url.ts
│  │  ├─ github.ts
│  │  ├─ unzip.ts
│  │  ├─ rules.ts
│  │  ├─ scanner.ts
│  │  ├─ score.ts
│  │  └─ worker.ts
│  └─ styles.css
├─ rules/
│  ├─ ai_fingerprints.yml
│  ├─ agentic_patterns.yml
│  ├─ secrets.yml
│  └─ owasp_mappings.yml
├─ assets/
│  └─ logo.svg
├─ README.md
├─ LICENSE
└─ vite.config.ts
```

> For a pure GitHub Pages MVP without bundling, use `/js/*.js` and ES modules; copy YAML to JSON ahead of time.

---

## 14) Pseudo‑Code Snippets
**Parse URL & Branch:**
```ts
export function parseGitHubUrl(input: string) {
  const m = input.match(/github\\.com\\/(.*?)\\/(.*?)(?:\\/(tree|blob)\\/(.*?))?(?:$|\\s|#)/);
  if (!m) throw new Error("Invalid GitHub URL");
  const [, owner, repo, , branch] = m;
  return { owner, repo: repo.replace(/\\.git$/, ''), branch: branch || "main" };
}
```

**Fetch ZIP:**
```ts
export async function fetchZip({ owner, repo, branch }: {owner:string; repo:string; branch:string}) {
  const url = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not fetch ZIP (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
```

**Unzip & Scan (simplified):**
```ts
import { unzipSync } from "fflate";

export async function scanZip(buf: Uint8Array, rules: Rule[]) {
  const files = unzipSync(buf);
  const findings: Finding[] = [];
  for (const path in files) {
    if (shouldSkip(path)) continue;
    const text = decodeToUtf8(files[path]);
    for (const rule of rules) {
      if (!ruleApplies(rule, path, text)) continue;
      const matches = rule.exec(text);
      for (const m of matches) {
        findings.push(toFinding(rule, path, m));
      }
    }
  }
  return findings;
}
```

**Export Markdown (outline):**
```ts
export function reportToMarkdown(report: Report) {
  // build a .md string with title, stats, inventory, and findings tables
  return md;
}
```

---

## 15) MVP Acceptance Criteria
- [ ] Paste a valid GitHub URL → **Scan** completes for common repo sizes (<100 MB).
- [ ] Inventory shows at least SDKs and frameworks when present.
- [ ] Findings table supports **filter by severity** and **search** by filename/rule.
- [ ] Each finding includes **rule id**, **OWASP mapping**, **evidence snippet**, and **remediation**.
- [ ] Export to **Markdown** (.md) and **PDF** both work and look presentable.
- [ ] Progress UI is responsive; no UI freeze during scan (use Worker for >5k files).

---

## 16) Roadmap (Post‑MVP)
- Web Worker by default; streaming unzip.
- Optional **GitHub OAuth** to raise API limits and **Save to Gist** (shareable permalink).
- Caching via ETag/If‑None‑Match and IndexDB.
- Heuristic AST parsing for better accuracy on prompts/tools.
- Rule update mechanism (host rule packs on a versioned JSON endpoint).
- CLI version (Node/Rust) for private repos.
- Simple risk badge (markdown snippet) for README files.

---

## 17) Branding & Copy
- **Product line:** “HawkAI — See the unseen.”
- **On‑page privacy note:** “Scanning happens locally in your browser. Your code is never uploaded.”
- **Empty state copy:** “Paste a GitHub URL to begin. Example: https://github.com/vercel/next.js”

---

## 18) License & Compliance
- Default to MIT for the site and rules (verify trademark on “HawkAI” if formalizing).
- Respect GitHub Terms for archive downloads; public repos only.

---

## 19) Open Questions
- Do we want a one‑click “Include node_modules/” for research cases?
- Should the risk score be normalized by repo size/language?
- Add “Evidence hash” to avoid shipping source lines in shared links?

---

## 20) Quick Setup Instructions
1. **Create repo**: `hawkai-scan` with GitHub Pages enabled (root or `/docs`).
2. Add `index.html`, `src` files, `rules/*.yml`.
3. Use a simple build (Vite) or raw ES modules, then publish.
4. Test on a handful of popular public repos with known AI usage.
5. Iterate rule packs and polish report visuals.
