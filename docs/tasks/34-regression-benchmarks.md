# Task 34: Agent Regression Test Suite
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Medium
**Depends on:** Task 33 (Eval Datasets), Task 29 (Agent Versioning — for version-pinned baselines)
**Blocks:** (none — terminal task in the eval pipeline)

## 1. Current State

There is no automated benchmark suite for any of the 230+ agents in ruflo. The general test suite in `v3/@claude-flow/cli/` covers infrastructure (spawn, memory, hooks) but does not validate that specific agent types produce correct or quality outputs.

The background worker `benchmark` in `v3/@claude-flow/hooks/src/workers/` runs performance benchmarks (latency, token throughput) but does not measure agent output quality or detect quality regressions between versions.

No `tests/benchmarks/` directory exists. There are no baseline quality scores on file. A developer can change an agent's system prompt without any automated signal that quality degraded.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/` — existing `benchmark` worker (performance only)
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/performance.ts` — performance CLI (latency/throughput, not quality)
- `/Users/morteza/Desktop/tools/ruflo/docs/tasks/33-eval-datasets.md` — Task 33 (data source for this task)
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — `eval_run_results` table (created by Task 33)

## 2. Gap Analysis

**What's missing:**
1. No `tests/benchmarks/` directory or benchmark definition files
2. No `BenchmarkRunner` that can score agent outputs against expected quality criteria
3. No baseline pinning — cannot compare "current" vs "last known good" quality
4. No CI integration — agent definition changes never trigger quality checks
5. No per-category benchmark coverage — the 230+ agents span 15+ categories with no category-level benchmarks
6. No regression threshold — no definition of "5% quality drop = CI failure"

**Concrete failure modes:**
- A developer rewrites the `engineering-backend-architect` system prompt; quality drops 15%; no automated signal fires; the regression ships
- A tool schema change in `task-tools.ts` silently breaks 10 agents that depend on it; no test suite catches this before production
- The `tdd-london-swarm` agent degrades after a hooks change; nobody notices for 3 weeks

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `tests/benchmarks/engineering/backend-architect.benchmark.json` | Benchmark definition for `engineering-backend-architect` |
| `tests/benchmarks/engineering/code-reviewer.benchmark.json` | Benchmark for `engineering-code-reviewer` |
| `tests/benchmarks/security/security-engineer.benchmark.json` | Benchmark for `engineering-security-engineer` |
| `tests/benchmarks/testing/tdd-london-swarm.benchmark.json` | Benchmark for `tdd-london-swarm` |
| `tests/benchmarks/marketing/seo-specialist.benchmark.json` | Benchmark for `marketing-seo-specialist` |
| `tests/benchmarks/_schema.json` | JSON Schema for benchmark definition files |
| `v3/@claude-flow/cli/src/eval/benchmark-runner.ts` | Loads benchmark files, runs against agents, compares to baseline |
| `v3/@claude-flow/cli/src/eval/quality-metrics.ts` | Quality metric functions: `containsExpected`, `schemaValid`, `noHallucination`, `customFn` |
| `v3/@claude-flow/cli/src/commands/benchmark.ts` | CLI: `benchmark run`, `benchmark list`, `benchmark baseline set` |
| `.github/workflows/agent-regression.yml` | GitHub Actions workflow that runs benchmarks on PR |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Confirm `eval_run_results` table (added by Task 33); add `benchmark_baselines` table |
| `v3/@claude-flow/cli/src/commands/performance.ts` | Add link to `benchmark` subcommand for quality benchmarks (separate from latency) |
| `v3/@claude-flow/cli/src/commands/index.ts` | Register `benchmark` command |

## 5. Implementation Steps

**Step 1: Define the benchmark file format**

Create `tests/benchmarks/_schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AgentBenchmark",
  "type": "object",
  "required": ["agentSlug", "version", "cases"],
  "properties": {
    "agentSlug":       { "type": "string" },
    "version":         { "type": "string", "description": "Min agent version this benchmark applies to" },
    "description":     { "type": "string" },
    "regressionThreshold": {
      "type": "number", "minimum": 0, "maximum": 1, "default": 0.05,
      "description": "Max allowed quality drop vs baseline (0.05 = 5%)"
    },
    "cases": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "input", "metrics"],
        "properties": {
          "id":          { "type": "string" },
          "description": { "type": "string" },
          "input": {
            "type": "object",
            "required": ["taskDescription"],
            "properties": {
              "taskDescription": { "type": "string" },
              "context":         {}
            }
          },
          "metrics": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["type"],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": ["contains_expected", "schema_valid", "no_hallucination", "length_range", "custom_fn"]
                },
                "weight":   { "type": "number", "minimum": 0, "maximum": 1 },
                "expected": {},
                "schema":   {},
                "minLength":{ "type": "integer" },
                "maxLength":{ "type": "integer" },
                "fnPath":   { "type": "string", "description": "Path to custom JS metric function" }
              }
            }
          },
          "baselineScore": {
            "type": "number", "minimum": 0, "maximum": 1,
            "description": "Pinned baseline quality score for regression detection"
          }
        }
      }
    }
  }
}
```

**Step 2: Write initial benchmark files**

`tests/benchmarks/engineering/backend-architect.benchmark.json`:

```json
{
  "agentSlug": "engineering-backend-architect",
  "version": "1.0.0",
  "description": "Backend architecture design quality benchmarks",
  "regressionThreshold": 0.05,
  "cases": [
    {
      "id": "rest-api-design",
      "description": "Should produce a valid REST API design with endpoints and data models",
      "input": {
        "taskDescription": "Design a REST API for a user authentication service with JWT tokens"
      },
      "metrics": [
        { "type": "contains_expected", "expected": ["endpoint", "JWT", "schema"], "weight": 0.4 },
        { "type": "length_range", "minLength": 200, "maxLength": 5000, "weight": 0.2 },
        { "type": "no_hallucination", "weight": 0.4 }
      ],
      "baselineScore": 0.85
    },
    {
      "id": "database-schema-design",
      "description": "Should produce a coherent database schema",
      "input": {
        "taskDescription": "Design a PostgreSQL schema for a multi-tenant SaaS application"
      },
      "metrics": [
        { "type": "contains_expected", "expected": ["table", "PRIMARY KEY", "FOREIGN KEY"], "weight": 0.5 },
        { "type": "schema_valid", "schema": { "type": "string", "minLength": 100 }, "weight": 0.5 }
      ],
      "baselineScore": 0.80
    }
  ]
}
```

`tests/benchmarks/security/security-engineer.benchmark.json`:

```json
{
  "agentSlug": "engineering-security-engineer",
  "version": "2.1.0",
  "description": "Security analysis quality benchmarks",
  "regressionThreshold": 0.05,
  "cases": [
    {
      "id": "jwt-vulnerability-detection",
      "description": "Should identify JWT-related vulnerabilities",
      "input": {
        "taskDescription": "Review this JWT implementation for security issues",
        "context": { "code": "jwt.sign(payload, 'secret', { algorithm: 'HS256' })" }
      },
      "metrics": [
        { "type": "contains_expected", "expected": ["algorithm", "secret", "vulnerability", "rotation"], "weight": 0.6 },
        { "type": "length_range", "minLength": 150, "maxLength": 3000, "weight": 0.2 },
        { "type": "no_hallucination", "weight": 0.2 }
      ],
      "baselineScore": 0.88
    }
  ]
}
```

**Step 3: Implement quality metrics**

Create `v3/@claude-flow/cli/src/eval/quality-metrics.ts`:

```typescript
export interface MetricConfig {
  type: 'contains_expected' | 'schema_valid' | 'no_hallucination' | 'length_range' | 'custom_fn';
  weight: number;
  expected?: string[];     // for contains_expected
  schema?: object;         // for schema_valid
  minLength?: number;      // for length_range
  maxLength?: number;      // for length_range
  fnPath?: string;         // for custom_fn
}

export interface MetricResult {
  type: string;
  score: number;           // 0.0–1.0
  weight: number;
  details: string;
}

export async function evaluateMetric(output: string, metric: MetricConfig): Promise<MetricResult> {
  switch (metric.type) {
    case 'contains_expected': {
      const expected = metric.expected ?? [];
      const found = expected.filter(e => output.toLowerCase().includes(e.toLowerCase()));
      const score = expected.length > 0 ? found.length / expected.length : 1.0;
      return { type: metric.type, score, weight: metric.weight,
               details: `Found ${found.length}/${expected.length} expected terms` };
    }
    case 'length_range': {
      const min = metric.minLength ?? 0;
      const max = metric.maxLength ?? Infinity;
      const inRange = output.length >= min && output.length <= max;
      return { type: metric.type, score: inRange ? 1.0 : 0.0, weight: metric.weight,
               details: `Output length: ${output.length} (expected ${min}–${max})` };
    }
    case 'no_hallucination': {
      // Heuristic: check for common hallucination markers
      const hallucinations = [
        /as of my (knowledge|training) cutoff/i,
        /I (cannot|can't) access/i,
        /I don't have (access|information)/i,
      ];
      const found = hallucinations.filter(p => p.test(output));
      const score = found.length === 0 ? 1.0 : Math.max(0, 1.0 - found.length * 0.3);
      return { type: metric.type, score, weight: metric.weight,
               details: `${found.length} hallucination markers found` };
    }
    case 'schema_valid': {
      // TODO: integrate AJV for JSON Schema validation
      return { type: metric.type, score: 1.0, weight: metric.weight, details: 'schema_valid stub' };
    }
    case 'custom_fn': {
      const fn = await import(metric.fnPath!);
      const score = await fn.default(output);
      return { type: metric.type, score, weight: metric.weight, details: `custom fn score: ${score}` };
    }
    default:
      return { type: 'unknown', score: 0, weight: 0, details: 'Unknown metric type' };
  }
}

export function weightedScore(results: MetricResult[]): number {
  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
  if (totalWeight === 0) return 0;
  return results.reduce((sum, r) => sum + r.score * r.weight, 0) / totalWeight;
}
```

**Step 4: Implement benchmark runner**

Create `v3/@claude-flow/cli/src/eval/benchmark-runner.ts`:

```typescript
import { readFile } from 'fs/promises';
import { evaluateMetric, weightedScore } from './quality-metrics.js';
import type { EvalRunResult } from '@claude-flow/shared/src/types/eval.js';

export interface BenchmarkDefinition {
  agentSlug: string;
  version: string;
  description: string;
  regressionThreshold: number;
  cases: BenchmarkCase[];
}

export interface BenchmarkCase {
  id: string;
  description?: string;
  input: { taskDescription: string; context?: Record<string, unknown> };
  metrics: MetricConfig[];
  baselineScore?: number;
}

export interface BenchmarkCaseResult {
  caseId: string;
  agentSlug: string;
  score: number;
  baselineScore?: number;
  regressed: boolean;
  metricResults: MetricResult[];
  output: string;
  latencyMs: number;
}

export class BenchmarkRunner {
  constructor(private agentRunner: AgentRunner) {}

  async runFile(benchmarkPath: string): Promise<BenchmarkCaseResult[]> {
    const raw = await readFile(benchmarkPath, 'utf-8');
    const def: BenchmarkDefinition = JSON.parse(raw);
    return this.runDefinition(def);
  }

  async runDefinition(def: BenchmarkDefinition): Promise<BenchmarkCaseResult[]> {
    const results: BenchmarkCaseResult[] = [];

    for (const bcase of def.cases) {
      const start = Date.now();
      let output = '';
      try {
        output = await this.agentRunner.run(def.agentSlug, bcase.input.taskDescription, bcase.input.context);
      } catch (e) {
        output = `ERROR: ${(e as Error).message}`;
      }
      const latencyMs = Date.now() - start;

      const metricResults = await Promise.all(
        bcase.metrics.map(m => evaluateMetric(output, m))
      );
      const score = weightedScore(metricResults);
      const regressed = bcase.baselineScore !== undefined
        ? (bcase.baselineScore - score) > def.regressionThreshold
        : false;

      results.push({ caseId: bcase.id, agentSlug: def.agentSlug, score,
                     baselineScore: bcase.baselineScore, regressed,
                     metricResults, output, latencyMs });
    }

    return results;
  }
}
```

**Step 5: GitHub Actions CI workflow**

Create `.github/workflows/agent-regression.yml`:

```yaml
name: Agent Regression Benchmarks

on:
  pull_request:
    paths:
      - '.claude/agents/**/*.md'
      - 'v3/mcp/tools/**/*.ts'

jobs:
  regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - name: Run agent regression benchmarks
        run: |
          npx claude-flow@v3alpha benchmark run \
            --dir tests/benchmarks/ \
            --regression-fail
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CLAUDE_FLOW_BENCHMARK_MODE: 'ci'
```

## 6. Key Code Templates

**Benchmark run CLI commands:**

```bash
# Run all benchmarks in the directory
npx claude-flow@v3alpha benchmark run --dir tests/benchmarks/

# Run benchmarks for a specific agent
npx claude-flow@v3alpha benchmark run --agent engineering-security-engineer

# Run and fail if any regression detected
npx claude-flow@v3alpha benchmark run --dir tests/benchmarks/ --regression-fail

# Set current run as new baseline
npx claude-flow@v3alpha benchmark baseline set --run-id <run-id>

# List all benchmark files and their baseline scores
npx claude-flow@v3alpha benchmark list
```

**BenchmarkCaseResult example output:**

```json
{
  "caseId": "jwt-vulnerability-detection",
  "agentSlug": "engineering-security-engineer",
  "score": 0.91,
  "baselineScore": 0.88,
  "regressed": false,
  "latencyMs": 2840,
  "metricResults": [
    { "type": "contains_expected", "score": 1.0, "weight": 0.6, "details": "Found 4/4 expected terms" },
    { "type": "length_range", "score": 1.0, "weight": 0.2, "details": "Output length: 842 (expected 150–3000)" },
    { "type": "no_hallucination", "score": 0.7, "weight": 0.2, "details": "1 hallucination marker found" }
  ]
}
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/eval/quality-metrics.test.ts`):
- `contains_expected` returns 1.0 when all expected terms present
- `contains_expected` returns 0.5 when half the terms present
- `length_range` returns 0.0 for output shorter than `minLength`
- `no_hallucination` returns < 1.0 when output contains "as of my training cutoff"
- `weightedScore()` computes correct weighted average

**Unit tests** (`v3/@claude-flow/cli/tests/eval/benchmark-runner.test.ts`):
- `runDefinition()` with stub `AgentRunner` produces one result per benchmark case
- `regressed: true` when `baselineScore - score > regressionThreshold`
- `regressed: false` when score equals or exceeds baseline
- Agent runner error is captured as `output: "ERROR: ..."`

**Integration tests** (`v3/@claude-flow/cli/tests/commands/benchmark.test.ts`):
- `benchmark run --dir tests/benchmarks/` reads all `.benchmark.json` files
- `benchmark run --regression-fail` exits 1 when a regression is detected
- `benchmark run --regression-fail` exits 0 when all agents pass

**Fixture coverage:**
- At least 5 benchmark files covering: engineering, security, testing, marketing, coordination categories
- Each benchmark file has at least 2 test cases

## 8. Definition of Done

- [ ] `tests/benchmarks/` directory exists with at least 5 benchmark JSON files
- [ ] All benchmark files validate against `tests/benchmarks/_schema.json`
- [ ] `npx claude-flow@v3alpha benchmark run --dir tests/benchmarks/` completes without error
- [ ] `--regression-fail` flag causes exit code 1 when any agent score drops > threshold vs baseline
- [ ] `.github/workflows/agent-regression.yml` is present and runs on PRs that modify `.claude/agents/**/*.md`
- [ ] `BenchmarkRunner` and `quality-metrics` unit tests pass
- [ ] Benchmark runner completes a full suite in < 60 seconds (using TestModel stub in CI, not live API)
- [ ] TypeScript compiles without errors
