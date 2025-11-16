## CI & Baselines

This document describes how the CI workflows validate detection stability against golden baselines, and how to update them.

### Workflows
- Quick (PR/push): `.github/workflows/scan-quick.yml`
  - Runs high‑priority repos and compares against `tests/baselines/high.json`
  - Uses tolerance 0.25
- Full (nightly): `.github/workflows/scan-full.yml`
  - Runs the full repo catalog and compares against `tests/baselines/full.json`
  - Uses tolerance 0.30

Both pass `GITHUB_TOKEN` to enable authenticated GitHub API downloads, reducing flakiness.

### Repo catalog
- Source list: `tests/test-repositories.yml`
- To add a repo: add an entry here, then run the local test runner and update baselines as needed.

### Running locally
High‑priority suite:
```bash
npx tsx tests/run-tests.ts --high
npx tsx tests/compare-baseline.ts --high --tolerance 0.25
```

Full suite:
```bash
npx tsx tests/run-tests.ts
npx tsx tests/compare-baseline.ts --baseline tests/baselines/full.json --tolerance 0.30
```

### Updating baselines
- Record‑only entries use `expectedFindings: -1`. After a successful run:
```bash
npx tsx tests/compare-baseline.ts --baseline tests/baselines/full.json --tolerance 0.30 --update
```
- To force update all entries with actuals (use cautiously):
```bash
npx tsx tests/compare-baseline.ts --baseline tests/baselines/full.json --update-all
```

### Pinning and tolerances
- Prefer exact slug matching (already enforced).
- For noisy repos, consider pinning a SHA in `tests/test-repositories.yml` or temporarily relaxing tolerance for that repo’s baseline value.

### Troubleshooting
- actual: -1
  - Usually a download or runtime error. Ensure `GITHUB_TOKEN` is set in CI; check the workflow logs for the failing repo.
  - Verify the repo/branch exists; if branch is omitted, the scanner resolves the default branch via GitHub API.
- Big swings in counts
  - Confirm no rule-pack changes unintentionally broadened patterns.
  - Check if the upstream repo had large changes; if expected, update the baseline.


