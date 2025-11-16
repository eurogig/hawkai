## Scoring & Confidence

This document explains how HawkAI fuses multiple detection signals into a composite confidence score and maps it to severity. All parameters are tunable at runtime via `public/config/scoring.json`.

### Signal roles
- Usage: direct evidence of AI activity (e.g., client calls, endpoints, graph.invoke).
- Hint: supportive evidence (e.g., imports, configs, model names).
- Metadata: contextual signals (protocol, environment).

### Weights and thresholds
Configured in `public/config/scoring.json`:
- weights.usage, weights.hint, weights.metadata
- thresholds.critical, thresholds.high, thresholds.moderate
- thresholds.minGroup: minimum composite for a hint‑only group to appear.

### Composite score
For a group:
1) Start with primary finding: weight(role) × confidence.
2) Add related signals with diminishing returns: each additional signal is scaled by 1 / (1 + 0.35 × index).
3) Apply boosts when corroborating signals are present:
   - usageAndHint
   - usageAndMetadata
   - multipleUsage
4) Apply demotions for lower‑quality evidence/context:
   - testOrExamplePath
   - loopOnlyWithoutInvoke
   - mockLikePath
   - commentOnly (reserved; not currently emitted)
5) Clamp to [0, 1], then map to severity using thresholds. Existing severity is only raised, never lowered.

### Grouping and deduplication
- Usage is primary; hints/metadata become related.
- Multiple usage findings of the same rule in the same file are grouped (top 3 close to primary are kept).
- Minimum‑evidence floor suppresses weak hint‑only groups.
- Per‑group related signals capped by `caps.perGroupRelated`.

### Performance safeguards
- Per‑file finding cap via `caps.perFileFindings` to prevent pathological hot files.

### Tuning the system
Edit `public/config/scoring.json` and rerun scans (no rebuild required).
- Increase `weights.usage` to emphasize direct calls.
- Increase `thresholds.minGroup` to reduce low‑evidence hint‑only groups.
- Increase `boosts.usageAndHint` to reward corroboration.
- Increase `demotions.loopOnlyWithoutInvoke` to penalize generic loops without agent invokes.

### CLI visibility
The CLI prints `compositeScore` and `contributingSignals` per group to help you tune:
- Contributing signals include ruleId, role, weight, and confidence.

### Examples
- If you see too many hint‑only groups in examples/tests, raise `thresholds.minGroup` and `demotions.testOrExamplePath`.
- If RAG usage is under‑ranked when combined with imports and endpoints, increase `boosts.usageAndHint` or `weights.hint`.


