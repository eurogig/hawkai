# HawkAI Test Repository Catalog

This directory contains a curated catalog of agentic AI repositories for continuous testing of HawkAI's detection rules.

## Files

- **`test-repositories.yml`** - YAML catalog of 23 test repositories with metadata
- **`run-tests.ts`** - Test runner script for validating detection rules against repositories

## Test Repository Catalog

The catalog contains repositories organized by framework:

- **LangGraph** (5 repos): Official LangGraph, examples, multi-agent patterns
- **LangChain** (3 repos): Official LangChain, templates, agent examples  
- **CrewAI** (2 repos): Official CrewAI framework and examples
- **AutoGen** (2 repos): Microsoft AutoGen framework and samples
- **OpenAI** (2 repos): OpenAI cookbook and Swarm examples
- **Anthropic** (2 repos): Anthropic cookbook and SDK examples
- **RAG** (2 repos): LlamaIndex and Haystack examples
- **Other frameworks**: Semantic Kernel, DSPy, multi-agent systems

## Usage

### Test All Repositories

```bash
npm run test:repos
```

### Test High Priority Repositories Only

```bash
npm run test:repos -- --high
```

### Test Specific Framework

```bash
npm run test:repos -- --framework langgraph
npm run test:repos -- --framework crewai
npm run test:repos -- --framework autogen
```

### Limit Number of Tests

```bash
npm run test:repos -- --limit 5
```

### Verbose Output

```bash
npm run test:repos -- --verbose
```

### Combine Options

```bash
npm run test:repos -- --high --verbose
npm run test:repos -- --framework langgraph --limit 3
```

## Test Priorities

Repositories are categorized by priority:

**High Priority:**
- `relari-ai/agent-examples` - Multi-framework examples (already tested)
- `langchain-ai/langgraph` - Official LangGraph
- `joaomdmoura/crewAI` - Official CrewAI
- `microsoft/autogen` - Official AutoGen

**Medium Priority:**
- Official framework examples and cookbooks

**Low Priority:**
- Community examples and specialized use cases

## Adding New Repositories

To add a new repository to the catalog, edit `test-repositories.yml`:

```yaml
- name: "Repository Name"
  url: "https://github.com/owner/repo"
  branch: "main"  # Optional, defaults to main
  description: "Description of the repository"
  frameworks: ["langgraph", "langchain"]  # Array of frameworks used
  languages: ["python", "typescript"]     # Array of languages
  test_categories:
    - "state_graph"
    - "agent_workflows"
    - "tool_decorators"
  notes: "Additional notes about the repository"
```

## Test Output

The test runner provides:
- Success/failure status for each repository
- Number of findings detected
- Execution time per repository
- Summary statistics

Example output:
```
Testing 23 repositories...

LangGraph Official Examples          ✓ 45 findings (234ms)
Relari Agent Examples                ✓ 118 findings (156ms)
...

Test Summary
================================================================================
Total Repositories: 23
Successful: 22
Failed: 1
Total Findings: 1,234
Average Findings per Repo: 56.1
```

## Continuous Testing

This catalog can be used for:
- **CI/CD Integration**: Run tests on every commit
- **Regression Testing**: Ensure rule changes don't break detection
- **Coverage Validation**: Verify rules work across different frameworks
- **Performance Monitoring**: Track scan times across repositories

## Updating the Catalog

The catalog should be periodically reviewed to:
- Remove repositories that no longer exist
- Update branch names if they change
- Add new high-quality examples
- Verify URLs are still valid
- Update test categories based on new patterns

## Notes

- All repositories are tested against the current rule set
- Tests run sequentially to avoid overwhelming GitHub's API
- Failed tests may indicate broken URLs or detection rule issues
- High finding counts don't necessarily indicate problems - they show active detection

