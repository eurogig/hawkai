# HawkAI Scan

HawkAI Scan is a 100% client-side scanner that inspects public GitHub repositories and produces an AI/agentic risk report aligned with the OWASP LLM Top 10. Paste a repository URL, run a scan directly in your browser, and export the results to Markdown or PDF.

## Features

- Fetches repository archives anonymously via GitHub codeload.
- Applies rule packs for AI fingerprints, agentic patterns, and secrets.
- Renders an interactive report with severity filters, OWASP mapping, and evidence snippets.
- Generates an AI inventory (SDKs, models, frameworks, tools) from findings.
- Exports reports to Markdown and PDF without sending code to a server.

## Getting Started

### Local Development

```bash
npm install
npm run dev
```

The development server runs at `http://localhost:5173`.

### Deploy to GitHub Pages

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/hawkai.git
   git branch -M main
   git push -u origin main
   ```

2. **Enable GitHub Pages:**
   - Go to your repository Settings → Pages
   - Under "Source", select "GitHub Actions"
   - The workflow will automatically deploy on every push to `main`

3. **Access your site:**
   - Your site will be available at `https://yourusername.github.io/hawkai/`
   - Or `https://yourusername.github.io/` if the repo is named `yourusername.github.io`

The GitHub Actions workflow (`.github/workflows/deploy.yml`) will automatically build and deploy your site whenever you push to the `main` branch.

## Directory Structure

```
.
├── index.html
├── public/
│   ├── assets/
│   │   └── logo.svg
│   └── rules/
│       ├── ai_fingerprints.yml
│       ├── agentic_patterns.yml
│       ├── owasp_mappings.yml
│       ├── secrets.yml
│       └── index.json
├── src/
│   ├── core/
│   │   ├── github.ts
│   │   ├── rules.ts
│   │   ├── scanService.ts
│   │   ├── scanner.ts
│   │   ├── score.ts
│   │   ├── unzip.ts
│   │   └── url.ts
│   ├── lib/
│   │   └── reportExport.ts
│   ├── ui/
│   │   ├── App.tsx
│   │   ├── FindingsTable.tsx
│   │   ├── Inventory.tsx
│   │   ├── Progress.tsx
│   │   ├── Report.tsx
│   │   ├── RiskScore.tsx
│   │   └── ScanForm.tsx
│   ├── main.tsx
│   ├── styles.css
│   └── types.ts
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── design/
    └── HawkAI_Design.md
```

## Rule Packs

Rule packs live under `public/rules` in YAML format. Update `index.json` when adding new packs. Each rule includes metadata such as severity, OWASP categories, remediation, and confidence. YAML is parsed at runtime and compiled to regular expressions.

## Scoring & Confidence

HawkAI uses multi-signal confidence scoring with grouping, boosts/demotions, and severity mapping. All knobs are tunable at runtime via `public/config/scoring.json`. See:
- `docs/scoring-and-confidence.md`

## CI & Baselines

Quick and nightly workflows validate scans against golden baselines with tolerances. Learn how to add repos, run locally, and update baselines:
- `docs/ci-and-baselines.md`

## Exports

- **Markdown:** Generated client-side and downloaded as a `.md` file.
- **PDF:** Uses `html2pdf.js` to render the current report section.

## Roadmap

See `design/HawkAI_Design.md` for the full vision and backlog, including future enhancements such as default worker-based scanning, additional rule packs, and GitHub OAuth integrations.

## License

This project is licensed under the MIT License.
