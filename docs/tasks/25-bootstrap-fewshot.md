# Task 25: Automatic Few-Shot Prompt Optimization (BootstrapFewShot)
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** High  
**Depends on:** Task 24 (Prompt Versioning — writes new versions), Task 19 (Task DAG — trace data source)  
**Blocks:** none

## 1. Current State

Agent prompts are hand-tuned once and never improved from real execution data.

| Component | Location | Current Behavior |
|---|---|---|
| Agent system prompts | `.claude/agents/**/*.md` | Static text; changed only by human commits |
| Task execution traces | `v3/@claude-flow/hooks/src/hooks/post-task.ts` | Fires after each task; no quality score attached |
| Quality measurement | No implementation | No mechanism to rate task output quality |
| Few-shot examples | No implementation | No examples in any agent prompt today |
| Prompt optimization pipeline | No implementation | DSPy `BootstrapFewShot` equivalent does not exist |
| Optimization scheduling | No implementation | No background worker for weekly re-optimization |

**Concrete failure mode:** The `engineering-security-engineer` agent produces false positives 20% of the time when reviewing authentication code. A human engineer knows this but has no mechanism to provide corrective examples to the agent. The agent continues making the same class of mistakes indefinitely because there is no feedback loop from trace data to prompt content.

## 2. Gap Analysis

- No trace quality scores — `post-task` hook fires but records no quality rating.
- No `(input, output, quality)` dataset builder — raw traces are not curated into optimization datasets.
- No `BootstrapFewShot` implementation — no algorithm to select highest-quality examples.
- No quality metric function — no standardized way to score an agent output.
- No prompt assembly that injects few-shot examples into an agent's system prompt.
- No weekly scheduling — optimization never runs automatically.
- No integration with `PromptVersionStore` (Task 24) to publish optimized prompts.
- No dry-run mode — no way to preview what would be changed before committing.

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/optimization/trace-collector.ts` | Queries AgentDB for high-quality traces; builds `(input, output, score)` dataset per agent |
| `v3/@claude-flow/hooks/src/optimization/quality-metric.ts` | Pluggable quality metric interface + built-in implementations |
| `v3/@claude-flow/hooks/src/optimization/bootstrap-fewshot.ts` | Core optimization algorithm: select examples, format, prepend to prompt |
| `v3/@claude-flow/hooks/src/optimization/prompt-optimizer.ts` | Orchestrates the full pipeline; integrates with `PromptVersionStore` |
| `v3/@claude-flow/hooks/src/workers/prompt-optimization-worker.ts` | Background worker #13 that runs the optimizer on a schedule |
| `v3/@claude-flow/memory/src/trace-quality-store.ts` | SQLite schema and CRUD for trace quality scores |
| `v3/@claude-flow/cli/src/commands/optimize.ts` | CLI commands: `optimize prompt`, `optimize status`, `optimize dataset` |
| `tests/optimization/bootstrap-fewshot.test.ts` | Unit tests for example selection algorithm |
| `tests/optimization/prompt-optimizer.test.ts` | Integration tests for full pipeline with mocked Claude API |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/@claude-flow/hooks/src/hooks/post-task.ts` | Accept and persist `quality_score?: number` (0.0–1.0) in the hook payload | Records quality rating alongside every task execution |
| `v3/@claude-flow/memory/src/agent-db.ts` | Add `createTraceQualityTable()` migration | Persistent storage for trace quality scores |
| `v3/@claude-flow/hooks/src/workers/` (existing worker list) | Register `prompt-optimization-worker` as worker #13 | Weekly scheduled execution |

## 5. Implementation Steps

1. **Define the data schema** — Create `trace-quality-store.ts` with `TraceRecord`, `OptimizationDataset`, and SQLite DDL. Add migration to `agent-db.ts`.

2. **Update `post-task` hook** — Add optional `quality_score` to the hook input schema. When provided, write a `TraceRecord` to `trace-quality-store`.

3. **Build `TraceCollector`** — Queries `trace_quality_records` for a given `agent_slug` over a date range. Filters to records with `quality_score >= threshold` (default 0.8). Returns `TraceRecord[]` sorted by quality score descending.

4. **Define `QualityMetric` interface** — A pluggable function `metric(input: string, output: string) => Promise<number>`. Provide three built-in implementations:
   - `LengthBasedMetric`: penalizes very short or very long outputs (heuristic).
   - `JSONValidityMetric`: scores 1.0 if output is valid JSON matching expected schema, 0.0 otherwise.
   - `LLMJudgeMetric`: uses a cheap Claude Haiku call to score 0.0–1.0.

5. **Build `BootstrapFewShot`** — The core algorithm (see pseudocode in Section 6):
   - Accepts a dataset of `(input, output, score)` triples.
   - Selects the top-K highest-scoring examples (default K=5).
   - Formats them as a few-shot block: `# Example N\nInput: ...\nOutput: ...`.
   - Returns the formatted few-shot block.

6. **Build `PromptOptimizer`** — Orchestrates the full pipeline:
   - Calls `TraceCollector` for the dataset.
   - Calls `BootstrapFewShot` to select examples.
   - Prepends examples to the current active prompt.
   - Computes a preliminary quality score (average of selected examples).
   - If `--dry-run`: prints the new prompt diff, returns without writing.
   - If `--promote`: calls `PromptVersionStore.save()` + `setActive()` immediately.
   - Otherwise: saves as new version (not promoted), records as candidate for A/B test if `--experiment`.

7. **Build the background worker** — In `prompt-optimization-worker.ts`, a `BackgroundWorker` subclass that runs every 7 days. For each agent that has > 50 traces since last optimization, runs `PromptOptimizer` in non-destructive mode (saves new version but does not auto-promote). Logs results.

8. **Build CLI commands** — In `commands/optimize.ts`, implement:
   - `optimize prompt --agent <slug> --period 30d [--dry-run] [--promote] [--experiment]`
   - `optimize status` — lists last optimization run per agent
   - `optimize dataset --agent <slug>` — shows the collected dataset for inspection

9. **Write tests** — Cover: example selection picks highest quality, deduplicates identical inputs, respects `maxExamples` cap, handles empty dataset gracefully.

## 6. Key Code Templates

### Full Optimization Pipeline Pseudocode

```
PIPELINE: BootstrapFewShot Optimization

INPUT:
  agent_slug: string
  period: "7d" | "14d" | "30d"
  quality_threshold: float = 0.80
  max_examples: int = 5
  quality_metric: QualityMetric = LLMJudgeMetric
  dry_run: bool = false
  promote: bool = false
  experiment: bool = false

STEP 1 — COLLECT TRACES
  traces = TraceCollector.query(
    agent_slug = agent_slug,
    from = now() - parse_period(period),
    min_quality_score = quality_threshold
  )
  IF traces.length == 0:
    LOG "No qualifying traces for {agent_slug} in period {period}"
    RETURN { status: "skipped", reason: "no_data" }

STEP 2 — DEDUPLICATE
  seen_inputs = Set()
  unique_traces = []
  FOR trace IN traces (sorted by quality_score DESC):
    input_hash = hash(trace.input)
    IF input_hash NOT IN seen_inputs:
      seen_inputs.add(input_hash)
      unique_traces.append(trace)
    IF len(unique_traces) >= max_examples * 3:  // collect 3x to allow metric filtering
      BREAK

STEP 3 — RE-SCORE WITH QUALITY METRIC (optional, if metric != stored scores)
  FOR trace IN unique_traces:
    trace.computed_score = quality_metric.score(trace.input, trace.output)

STEP 4 — SELECT TOP-K
  sorted_traces = sort(unique_traces, key=computed_score, descending=True)
  selected = sorted_traces[:max_examples]

STEP 5 — FORMAT FEW-SHOT BLOCK
  few_shot_block = ""
  FOR i, example IN enumerate(selected):
    few_shot_block += f"""
## Example {i+1} (quality: {example.computed_score:.2f})

**Input task:**
{example.input}

**Expected output:**
{example.output}

---
"""

STEP 6 — COMPOSE NEW PROMPT
  current_prompt = PromptVersionStore.getActive(agent_slug).prompt
  new_prompt = """
# Few-Shot Examples
The following are high-quality examples of this agent's expected behavior.
Use them as a reference for output format and reasoning quality.

""" + few_shot_block + """
# Agent Instructions
""" + current_prompt

STEP 7 — COMPUTE EXPECTED QUALITY
  baseline_quality = mean(
    PromptVersionStore.getActive(agent_slug).qualityScore ?? 0.0
  )
  projected_quality = mean([t.computed_score for t in selected])
  improvement = projected_quality - baseline_quality

STEP 8 — DECIDE ACTION
  IF dry_run:
    PRINT diff(current_prompt, new_prompt)
    PRINT f"Projected quality improvement: {improvement:+.3f}"
    RETURN { status: "dry_run", projected_quality, improvement, example_count: len(selected) }

  new_version = bump_minor_version(PromptVersionStore.getActive(agent_slug).version)
  PromptVersionStore.save({
    agent_slug, version: new_version, prompt: new_prompt,
    changelog: f"BootstrapFewShot: +{len(selected)} examples, projected quality {projected_quality:.2f}",
    quality_score: projected_quality,
    published_by: "bootstrap-fewshot"
  })

  IF promote AND improvement >= 0.02:  // only promote if > 2% improvement
    PromptVersionStore.setActive(agent_slug, new_version)
    LOG f"Promoted {agent_slug} to {new_version} (quality {baseline_quality:.2f} → {projected_quality:.2f})"

  IF experiment:
    PromptVersionStore.saveExperiment({
      agent_slug,
      control: PromptVersionStore.getActive(agent_slug).version,
      candidate: new_version,
      traffic_pct: 0.1,
      started_at: now()
    })

  RETURN {
    status: "optimized",
    new_version,
    promoted: promote AND improvement >= 0.02,
    experiment_started: experiment,
    projected_quality,
    improvement,
    example_count: len(selected)
  }
```

```typescript
// v3/@claude-flow/hooks/src/optimization/quality-metric.ts

export interface QualityMetric {
  name: string;
  score(input: string, output: string, expectedSchema?: unknown): Promise<number>;
}

export class LengthBasedMetric implements QualityMetric {
  name = 'length-based';
  private minLength: number;
  private maxLength: number;

  constructor(minLength = 50, maxLength = 8000) {
    this.minLength = minLength;
    this.maxLength = maxLength;
  }

  async score(_input: string, output: string): Promise<number> {
    const len = output.length;
    if (len < this.minLength) return 0.2;
    if (len > this.maxLength) return 0.6;
    return 1.0;
  }
}

export class JSONValidityMetric implements QualityMetric {
  name = 'json-validity';

  constructor(private requiredFields: string[] = []) {}

  async score(_input: string, output: string): Promise<number> {
    try {
      const parsed = JSON.parse(output);
      if (this.requiredFields.length === 0) return 1.0;
      const hasAll = this.requiredFields.every(f => f in parsed);
      return hasAll ? 1.0 : 0.5;
    } catch {
      return 0.0;
    }
  }
}

export class LLMJudgeMetric implements QualityMetric {
  name = 'llm-judge';

  constructor(private claudeHaiku: (prompt: string) => Promise<string>) {}

  async score(input: string, output: string): Promise<number> {
    const prompt = `
Rate the quality of this AI agent response on a scale from 0.0 to 1.0.

TASK: ${input.slice(0, 500)}

RESPONSE: ${output.slice(0, 1000)}

Criteria:
- Completeness (0–0.4): Does it fully address the task?
- Format (0–0.3): Is the output structured and readable?
- Accuracy (0–0.3): Does it appear factually correct and safe?

Return ONLY a JSON object: {"score": 0.XX, "reason": "one sentence"}
`;
    try {
      const result = await this.claudeHaiku(prompt);
      const parsed = JSON.parse(result);
      const s = Number(parsed.score);
      return isNaN(s) ? 0.0 : Math.min(1.0, Math.max(0.0, s));
    } catch {
      return 0.0;
    }
  }
}
```

```typescript
// v3/@claude-flow/hooks/src/optimization/bootstrap-fewshot.ts

export interface TraceRecord {
  traceId:     string;
  agentSlug:   string;
  input:       string;    // task description
  output:      string;    // agent's raw output
  qualityScore: number;   // 0.0–1.0; recorded at execution time
  createdAt:   Date;
}

export interface FewShotExample {
  input:        string;
  output:       string;
  qualityScore: number;
}

export interface BootstrapFewShotConfig {
  maxExamples:       number;    // default: 5
  minQualityScore:   number;    // default: 0.80
  deduplicateInputs: boolean;   // default: true
  qualityMetric?:    QualityMetric; // optional re-scoring
}

import { QualityMetric } from './quality-metric.js';

export class BootstrapFewShot {
  constructor(private config: BootstrapFewShotConfig = { maxExamples: 5, minQualityScore: 0.80, deduplicateInputs: true }) {}

  async selectExamples(traces: TraceRecord[]): Promise<FewShotExample[]> {
    let candidates = traces.filter(t => t.qualityScore >= this.config.minQualityScore);

    // Deduplicate by input hash
    if (this.config.deduplicateInputs) {
      const seen = new Set<string>();
      candidates = candidates.filter(t => {
        const h = hashString(t.input);
        if (seen.has(h)) return false;
        seen.add(h);
        return true;
      });
    }

    // Re-score if a quality metric was provided
    if (this.config.qualityMetric) {
      const rescored = await Promise.all(
        candidates.map(async t => ({
          ...t,
          qualityScore: await this.config.qualityMetric!.score(t.input, t.output),
        }))
      );
      candidates = rescored;
    }

    // Sort descending by quality, take top K
    return candidates
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, this.config.maxExamples)
      .map(t => ({ input: t.input, output: t.output, qualityScore: t.qualityScore }));
  }

  formatFewShotBlock(examples: FewShotExample[]): string {
    if (examples.length === 0) return '';

    const header = `# High-Quality Few-Shot Examples\n\nThe following examples demonstrate the expected input/output quality.\n\n`;
    const body = examples.map((ex, i) => `
## Example ${i + 1} (quality score: ${ex.qualityScore.toFixed(2)})

**Input task:**
${ex.input}

**Expected output:**
${ex.output}

---`).join('\n');

    return header + body + '\n\n';
  }

  composePrompt(agentSystemPrompt: string, examples: FewShotExample[]): string {
    const fewShotBlock = this.formatFewShotBlock(examples);
    if (!fewShotBlock) return agentSystemPrompt;

    return fewShotBlock + '\n# Agent Instructions\n\n' + agentSystemPrompt;
  }
}

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(s.length, 200); i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}
```

```typescript
// v3/@claude-flow/cli/src/commands/optimize.ts (CLI command examples)

// Usage:
// npx claude-flow@v3alpha optimize prompt --agent engineering-security-engineer --period 30d --dry-run
// npx claude-flow@v3alpha optimize prompt --agent tdd-london-swarm --period 14d --promote
// npx claude-flow@v3alpha optimize prompt --agent coder --period 7d --experiment
// npx claude-flow@v3alpha optimize status
// npx claude-flow@v3alpha optimize dataset --agent engineering-security-engineer --period 30d
```

## 7. Testing Strategy

```typescript
// tests/optimization/bootstrap-fewshot.test.ts
import { BootstrapFewShot, TraceRecord } from '../../v3/@claude-flow/hooks/src/optimization/bootstrap-fewshot.js';

const makeTrace = (id: string, quality: number, input = `task-${id}`): TraceRecord => ({
  traceId: id, agentSlug: 'test-agent', input, output: `output-${id}`,
  qualityScore: quality, createdAt: new Date()
});

describe('selectExamples()', () => {
  it('selects top-K by quality score', async () => {
    const bfs = new BootstrapFewShot({ maxExamples: 3, minQualityScore: 0.8, deduplicateInputs: false });
    const traces = [
      makeTrace('a', 0.95), makeTrace('b', 0.90), makeTrace('c', 0.85),
      makeTrace('d', 0.75), makeTrace('e', 0.70),
    ];
    const selected = await bfs.selectExamples(traces);
    expect(selected).toHaveLength(3);
    expect(selected[0].qualityScore).toBe(0.95);
    expect(selected.every(s => s.qualityScore >= 0.8)).toBe(true);
  });

  it('filters out traces below min quality threshold', async () => {
    const bfs = new BootstrapFewShot({ maxExamples: 5, minQualityScore: 0.9, deduplicateInputs: false });
    const traces = [makeTrace('a', 0.88), makeTrace('b', 0.79)];
    const selected = await bfs.selectExamples(traces);
    expect(selected).toHaveLength(0);
  });

  it('deduplicates identical inputs', async () => {
    const bfs = new BootstrapFewShot({ maxExamples: 5, minQualityScore: 0.8, deduplicateInputs: true });
    const traces = [
      makeTrace('a', 0.95, 'same input'),
      makeTrace('b', 0.90, 'same input'),  // duplicate input
      makeTrace('c', 0.85, 'different'),
    ];
    const selected = await bfs.selectExamples(traces);
    expect(selected).toHaveLength(2);
    expect(selected.map(s => s.input)).toContain('same input');
    expect(selected.map(s => s.input)).toContain('different');
  });

  it('returns empty array for empty input', async () => {
    const bfs = new BootstrapFewShot({ maxExamples: 5, minQualityScore: 0.8, deduplicateInputs: true });
    const selected = await bfs.selectExamples([]);
    expect(selected).toHaveLength(0);
  });
});

describe('formatFewShotBlock()', () => {
  it('returns empty string for empty examples', () => {
    const bfs = new BootstrapFewShot({ maxExamples: 3, minQualityScore: 0.8, deduplicateInputs: true });
    expect(bfs.formatFewShotBlock([])).toBe('');
  });

  it('includes all examples in numbered format', () => {
    const bfs = new BootstrapFewShot({ maxExamples: 3, minQualityScore: 0.8, deduplicateInputs: true });
    const block = bfs.formatFewShotBlock([
      { input: 'task A', output: 'result A', qualityScore: 0.95 },
      { input: 'task B', output: 'result B', qualityScore: 0.88 },
    ]);
    expect(block).toContain('Example 1');
    expect(block).toContain('Example 2');
    expect(block).toContain('task A');
    expect(block).toContain('result B');
  });
});

describe('composePrompt()', () => {
  it('prepends few-shot block before agent instructions', () => {
    const bfs = new BootstrapFewShot({ maxExamples: 3, minQualityScore: 0.8, deduplicateInputs: true });
    const composed = bfs.composePrompt('Be a coder.', [
      { input: 'task A', output: 'result A', qualityScore: 0.95 }
    ]);
    expect(composed.indexOf('Example 1')).toBeLessThan(composed.indexOf('Be a coder.'));
  });
});

describe('LLMJudgeMetric', () => {
  it('returns 0.0 when LLM response is not valid JSON', async () => {
    const mockHaiku = async () => 'not json';
    const metric = new LLMJudgeMetric(mockHaiku);
    const score = await metric.score('task', 'output');
    expect(score).toBe(0.0);
  });

  it('clamps score to [0, 1]', async () => {
    const mockHaiku = async () => JSON.stringify({ score: 1.5, reason: 'great' });
    const metric = new LLMJudgeMetric(mockHaiku);
    const score = await metric.score('task', 'output');
    expect(score).toBe(1.0);
  });
});
```

## 8. Definition of Done

- [ ] `post-task` hook accepts and persists `quality_score: number` (0.0–1.0) to SQLite
- [ ] `TraceCollector.query()` returns traces filtered by agent slug, date range, and min quality score
- [ ] `BootstrapFewShot.selectExamples()` selects top-K, deduplicates inputs, respects threshold
- [ ] `BootstrapFewShot.formatFewShotBlock()` produces numbered few-shot block with quality scores
- [ ] `BootstrapFewShot.composePrompt()` places few-shot block before agent instructions
- [ ] `LLMJudgeMetric` clamps returned scores to [0.0, 1.0] and returns 0.0 on JSON parse failure
- [ ] `PromptOptimizer` saves a new prompt version to `PromptVersionStore` (Task 24) on non-dry-run
- [ ] `PromptOptimizer` only auto-promotes when improvement >= 2% quality score increase
- [ ] Dry-run mode prints diff and projected improvement without writing to store
- [ ] `optimize prompt --experiment` saves an A/B experiment in `PromptVersionStore`
- [ ] Background worker runs the optimizer for agents with > 50 traces in the past 7 days
- [ ] All unit tests pass with zero Claude API calls (mocked Haiku for LLMJudgeMetric)
- [ ] `tsc --noEmit` passes across all new and modified files
