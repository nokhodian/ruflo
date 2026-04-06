# Task 33: Automated Eval Dataset from Production Traces
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Medium
**Depends on:** (requires observability hooks to be wired — IMP-021/022 prerequisite; can be built in parallel against stub data)
**Blocks:** Task 34 (Regression Benchmarks)

## 1. Current State

There is no automated mechanism to collect evaluation data from production agent runs. The hooks system (`v3/@claude-flow/hooks/`) fires `post-task` events with success/failure status but does not persist structured trace data that includes task inputs, agent outputs, retry counts, or quality scores.

The 12 background workers in `v3/@claude-flow/hooks/src/workers/` include an `ultralearn` worker and a `consolidate` worker, but neither produces a structured evaluation dataset. The `post-task` hook (`v3/@claude-flow/hooks/src/workers/mcp-tools.ts`) only logs; it does not store to AgentDB with the fields needed for eval.

AgentDB (`v3/@claude-flow/memory/src/agentdb-backend.ts`) stores memory entries and agent state but has no `eval_traces` or `eval_datasets` table.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/` — background workers (ultralearn, consolidate, audit, etc.)
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB schema and backend
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts` — hooks CLI
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/task-tools.ts` — task completion handler

## 2. Gap Analysis

**What's missing:**
1. No `eval_traces` table in AgentDB — production task runs are not persisted in eval-ready form
2. No automatic flagging of traces that need review (`retry_count > 1` or quality < threshold)
3. No `eval_datasets` table — cannot group traces into named datasets for benchmark runs
4. No human review workflow — no way to add corrected outputs to flagged traces
5. No CLI commands to create, list, or run against eval datasets
6. Task 34 (Regression Benchmarks) has no data source to run against

**Concrete failure modes:**
- An agent that was silently degrading over the past 30 days has no evidence trail; the regression is invisible until a user reports a bad output
- Task 34 (regression benchmarks) cannot run because there are no baseline-labeled examples
- DSPy-style prompt optimization (IMP-036, future) requires (input, output, quality_score) pairs; none exist

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/cli/src/eval/trace-collector.ts` | Writes structured `EvalTrace` records to AgentDB on task completion |
| `v3/@claude-flow/cli/src/eval/dataset-manager.ts` | Creates named `EvalDataset`s from traces; manages review status |
| `v3/@claude-flow/cli/src/eval/dataset-runner.ts` | Runs a named dataset against live agents; produces `EvalRunResult` |
| `v3/@claude-flow/cli/src/commands/eval.ts` | CLI: `eval dataset create/list/review/run/export` |
| `v3/@claude-flow/shared/src/types/eval.ts` | `EvalTrace`, `EvalDataset`, `EvalDatasetEntry`, `EvalRunResult` interfaces |
| `tests/eval/fixtures/` | Sample trace fixtures for unit tests |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `eval_traces` and `eval_datasets` table migrations; expose CRUD methods |
| `v3/@claude-flow/hooks/src/workers/mcp-tools.ts` (or equivalent post-task hook) | Call `TraceCollector.record()` on every `post-task` event |
| `v3/mcp/tools/task-tools.ts` | Attach `retryCount`, `qualityScore` to task completion payload |
| `v3/@claude-flow/cli/src/commands/index.ts` | Register `eval` command |

## 5. Implementation Steps

**Step 1: Define shared types**

Create `v3/@claude-flow/shared/src/types/eval.ts`:

```typescript
export interface EvalTrace {
  traceId: string;           // uuid
  agentSlug: string;
  agentVersion: string;      // from Task 29 frontmatter
  taskDescription: string;
  taskInput: Record<string, unknown>;
  agentOutput: string;
  retryCount: number;        // number of retries before success/failure
  qualityScore?: number;     // 0.0–1.0, set by quality metric or human reviewer
  outcome: 'success' | 'failure' | 'timeout';
  latencyMs: number;
  tokenCount?: number;
  costUsd?: number;
  capturedAt: string;        // ISO 8601
  reviewStatus: 'pending' | 'approved' | 'corrected' | 'rejected';
  correctedOutput?: string;  // human-provided correction
  tags: string[];            // e.g. ["security", "auth", "retry"]
}

export interface EvalDatasetEntry {
  entryId: string;
  datasetId: string;
  traceId: string;
  addedAt: string;
}

export interface EvalDataset {
  datasetId: string;
  name: string;
  description: string;
  agentSlugs: string[];      // empty = all agents
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  baselineRunId?: string;    // run ID of the pinned baseline (Task 34)
}

export interface EvalRunResult {
  runId: string;
  datasetId: string;
  runAt: string;
  agentVersion: string;
  entriesTested: number;
  passCount: number;
  failCount: number;
  avgQualityScore: number;
  avgLatencyMs: number;
  regressionDetected: boolean;
  regressionDetails?: RegressionDetail[];
}

export interface RegressionDetail {
  traceId: string;
  agentSlug: string;
  baselineScore: number;
  currentScore: number;
  delta: number;             // negative = regression
}
```

**Step 2: Add AgentDB tables**

In `v3/@claude-flow/memory/src/agentdb-backend.ts`, add migration:

```typescript
await db.exec(`
  CREATE TABLE IF NOT EXISTS eval_traces (
    trace_id        TEXT    PRIMARY KEY,
    agent_slug      TEXT    NOT NULL,
    agent_version   TEXT    NOT NULL DEFAULT '1.0.0',
    task_description TEXT   NOT NULL,
    task_input      TEXT    NOT NULL DEFAULT '{}',  -- JSON
    agent_output    TEXT    NOT NULL DEFAULT '',
    retry_count     INTEGER NOT NULL DEFAULT 0,
    quality_score   REAL,
    outcome         TEXT    NOT NULL DEFAULT 'success',
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    token_count     INTEGER,
    cost_usd        REAL,
    captured_at     TEXT    NOT NULL,
    review_status   TEXT    NOT NULL DEFAULT 'pending',
    corrected_output TEXT,
    tags            TEXT    NOT NULL DEFAULT '[]'   -- JSON array
  );

  CREATE INDEX IF NOT EXISTS idx_eval_traces_agent    ON eval_traces(agent_slug);
  CREATE INDEX IF NOT EXISTS idx_eval_traces_outcome  ON eval_traces(outcome);
  CREATE INDEX IF NOT EXISTS idx_eval_traces_review   ON eval_traces(review_status);
  CREATE INDEX IF NOT EXISTS idx_eval_traces_retry    ON eval_traces(retry_count);

  CREATE TABLE IF NOT EXISTS eval_datasets (
    dataset_id      TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL UNIQUE,
    description     TEXT    NOT NULL DEFAULT '',
    agent_slugs     TEXT    NOT NULL DEFAULT '[]',  -- JSON array
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    baseline_run_id TEXT
  );

  CREATE TABLE IF NOT EXISTS eval_dataset_entries (
    entry_id    TEXT    PRIMARY KEY,
    dataset_id  TEXT    NOT NULL REFERENCES eval_datasets(dataset_id),
    trace_id    TEXT    NOT NULL REFERENCES eval_traces(trace_id),
    added_at    TEXT    NOT NULL,
    UNIQUE(dataset_id, trace_id)
  );

  CREATE INDEX IF NOT EXISTS idx_eval_entries_dataset ON eval_dataset_entries(dataset_id);

  CREATE TABLE IF NOT EXISTS eval_run_results (
    run_id              TEXT    PRIMARY KEY,
    dataset_id          TEXT    NOT NULL,
    run_at              TEXT    NOT NULL,
    agent_version       TEXT    NOT NULL,
    entries_tested      INTEGER NOT NULL DEFAULT 0,
    pass_count          INTEGER NOT NULL DEFAULT 0,
    fail_count          INTEGER NOT NULL DEFAULT 0,
    avg_quality_score   REAL,
    avg_latency_ms      REAL,
    regression_detected INTEGER NOT NULL DEFAULT 0,
    regression_details  TEXT    NOT NULL DEFAULT '[]'  -- JSON
  );
`);
```

**Step 3: Build trace-collector**

Create `v3/@claude-flow/cli/src/eval/trace-collector.ts`:

```typescript
import { randomUUID } from 'crypto';
import type { EvalTrace } from '@claude-flow/shared/src/types/eval.js';

export class TraceCollector {
  constructor(private db: AgentDBBackend) {}

  async record(trace: Omit<EvalTrace, 'traceId' | 'capturedAt' | 'reviewStatus' | 'tags'>): Promise<EvalTrace> {
    const fullTrace: EvalTrace = {
      ...trace,
      traceId: randomUUID(),
      capturedAt: new Date().toISOString(),
      reviewStatus: this.autoReviewStatus(trace),
      tags: this.autoTag(trace),
    };

    await this.db.run(
      `INSERT INTO eval_traces
       (trace_id, agent_slug, agent_version, task_description, task_input, agent_output,
        retry_count, quality_score, outcome, latency_ms, token_count, cost_usd,
        captured_at, review_status, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullTrace.traceId, fullTrace.agentSlug, fullTrace.agentVersion,
        fullTrace.taskDescription, JSON.stringify(fullTrace.taskInput),
        fullTrace.agentOutput, fullTrace.retryCount, fullTrace.qualityScore ?? null,
        fullTrace.outcome, fullTrace.latencyMs, fullTrace.tokenCount ?? null,
        fullTrace.costUsd ?? null, fullTrace.capturedAt,
        fullTrace.reviewStatus, JSON.stringify(fullTrace.tags),
      ]
    );

    return fullTrace;
  }

  /** Auto-flag for review if retry_count > 1 or quality_score < 0.6 */
  private autoReviewStatus(trace: Partial<EvalTrace>): EvalTrace['reviewStatus'] {
    if ((trace.retryCount ?? 0) > 1) return 'pending';
    if (trace.qualityScore !== undefined && trace.qualityScore < 0.6) return 'pending';
    if (trace.outcome === 'failure') return 'pending';
    return 'approved';  // clean trace, auto-approve
  }

  private autoTag(trace: Partial<EvalTrace>): string[] {
    const tags: string[] = [];
    if ((trace.retryCount ?? 0) > 1) tags.push('high-retry');
    if (trace.outcome === 'failure') tags.push('failure');
    if (trace.outcome === 'timeout') tags.push('timeout');
    if (trace.agentSlug) tags.push(trace.agentSlug.split('-')[0]); // category tag
    return tags;
  }

  async getTracesPendingReview(limit = 50): Promise<EvalTrace[]> {
    return this.db.all(
      `SELECT * FROM eval_traces WHERE review_status = 'pending'
       ORDER BY captured_at DESC LIMIT ?`,
      [limit]
    );
  }
}
```

**Step 4: Hook into post-task event**

In the post-task hook handler (in `v3/@claude-flow/hooks/src/workers/mcp-tools.ts` or equivalent), add:

```typescript
import { TraceCollector } from '../../cli/src/eval/trace-collector.js';

// Inside post-task handler:
async function handlePostTask(event: PostTaskEvent, ctx: WorkerContext): Promise<void> {
  // ... existing logic ...

  const collector = new TraceCollector(ctx.db);
  await collector.record({
    agentSlug: event.agentSlug,
    agentVersion: event.agentVersion ?? '1.0.0',
    taskDescription: event.taskDescription,
    taskInput: event.taskInput ?? {},
    agentOutput: event.output ?? '',
    retryCount: event.retryCount ?? 0,
    qualityScore: event.qualityScore,
    outcome: event.success ? 'success' : 'failure',
    latencyMs: event.latencyMs ?? 0,
    tokenCount: event.tokenCount,
    costUsd: event.costUsd,
  });
}
```

**Step 5: Build CLI commands**

Create `v3/@claude-flow/cli/src/commands/eval.ts`:

```typescript
import { Command } from 'commander';

export function registerEvalCommand(program: Command): void {
  const cmd = program.command('eval').description('Evaluation dataset management');

  cmd.command('dataset create')
    .description('Create a dataset from recent production traces')
    .option('--from-traces', 'Seed from flagged traces')
    .option('--min-retries <n>', 'Include traces with retry_count >= n', parseInt)
    .option('--period <duration>', 'Time window, e.g. 30d, 7d', '30d')
    .option('--name <name>', 'Dataset name', 'production-failures')
    .action(async (opts) => {
      const mgr = await getDatasetManager();
      const dataset = await mgr.createFromTraces({
        name: opts.name,
        minRetries: opts.minRetries,
        periodDays: parsePeriodDays(opts.period),
        seedFromFlagged: opts.fromTraces,
      });
      console.log(`Dataset created: ${dataset.datasetId} (${dataset.entryCount} entries)`);
    });

  cmd.command('dataset list')
    .action(async () => {
      const mgr = await getDatasetManager();
      const datasets = await mgr.listDatasets();
      console.table(datasets.map(d => ({
        id: d.datasetId, name: d.name, entries: d.entryCount, baseline: d.baselineRunId ?? '(none)'
      })));
    });

  cmd.command('dataset review')
    .description('Interactive review of pending traces')
    .option('--dataset <id>', 'Dataset ID')
    .action(async (opts) => {
      // Opens interactive CLI review loop for pending traces
      await interactiveReview(opts.dataset);
    });

  cmd.command('run')
    .description('Run eval dataset against live agents')
    .requiredOption('--dataset <id>', 'Dataset ID')
    .option('--agents <slugs>', 'Comma-separated agent slugs (default: all in dataset)')
    .option('--set-baseline', 'Pin this run as the regression baseline')
    .action(async (opts) => {
      const runner = await getDatasetRunner();
      const result = await runner.run({
        datasetId: opts.dataset,
        agentSlugs: opts.agents?.split(','),
        setAsBaseline: opts.setBaseline,
      });
      console.log(`Run ${result.runId}: ${result.passCount}/${result.entriesTested} passed`);
      if (result.regressionDetected) {
        console.error('REGRESSION DETECTED');
        process.exitCode = 1;
      }
    });

  cmd.command('export')
    .description('Export dataset to JSON for offline analysis')
    .requiredOption('--dataset <id>')
    .option('--output <file>', 'Output file path', 'eval-dataset.json')
    .action(async (opts) => {
      const mgr = await getDatasetManager();
      await mgr.exportToFile(opts.dataset, opts.output);
      console.log(`Exported to ${opts.output}`);
    });
}
```

## 6. Key Code Templates

**EvalTrace JSON example (persisted to AgentDB):**

```json
{
  "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "agentSlug": "engineering-security-engineer",
  "agentVersion": "2.1.0",
  "taskDescription": "Review JWT validation in src/auth/jwt.ts",
  "taskInput": { "file": "src/auth/jwt.ts", "context": "production incident" },
  "agentOutput": "Found 2 issues: 1) Algorithm not restricted...",
  "retryCount": 2,
  "qualityScore": 0.72,
  "outcome": "success",
  "latencyMs": 3420,
  "tokenCount": 1840,
  "costUsd": 0.0055,
  "capturedAt": "2026-04-06T12:00:00Z",
  "reviewStatus": "pending",
  "correctedOutput": null,
  "tags": ["high-retry", "engineering", "security"]
}
```

**CLI commands:**

```bash
# Create dataset from traces with 2+ retries in last 30 days
npx claude-flow@v3alpha eval dataset create --from-traces --min-retries 2 --period 30d

# List all datasets
npx claude-flow@v3alpha eval dataset list

# Interactive human review
npx claude-flow@v3alpha eval dataset review --dataset prod-failures-2026-04

# Run dataset against live agents
npx claude-flow@v3alpha eval run --dataset prod-failures-2026-04

# Export for offline analysis
npx claude-flow@v3alpha eval export --dataset prod-failures-2026-04 --output ./eval-data.json
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/eval/trace-collector.test.ts`):
- `record()` inserts a row into `eval_traces`
- `autoReviewStatus()` returns `'pending'` when `retryCount > 1`
- `autoReviewStatus()` returns `'pending'` when `qualityScore < 0.6`
- `autoReviewStatus()` returns `'approved'` for clean successful trace
- `autoTag()` adds `'high-retry'` tag when `retryCount > 1`
- `getTracesPendingReview()` returns only `review_status = 'pending'` records

**Unit tests** (`v3/@claude-flow/cli/tests/eval/dataset-manager.test.ts`):
- `createFromTraces()` includes only traces matching filter criteria
- `listDatasets()` returns all datasets sorted by `created_at DESC`
- `exportToFile()` writes valid JSON matching `EvalDataset` schema

**Integration tests** (`v3/@claude-flow/cli/tests/commands/eval.test.ts`):
- `eval dataset create --from-traces` creates a non-empty dataset when flagged traces exist
- `eval run --dataset <id>` exits 0 when no regressions; exits 1 when regression detected
- `eval export` produces readable JSON file

## 8. Definition of Done

- [ ] `eval_traces`, `eval_datasets`, `eval_dataset_entries`, `eval_run_results` tables exist in AgentDB after `init`
- [ ] Every `post-task` hook event writes a record to `eval_traces`
- [ ] Traces with `retry_count > 1` or `outcome = 'failure'` automatically get `review_status = 'pending'`
- [ ] `npx claude-flow@v3alpha eval dataset create --from-traces --period 30d` creates a non-empty dataset
- [ ] `npx claude-flow@v3alpha eval run --dataset <id>` runs through entries and produces a `EvalRunResult`
- [ ] `npx claude-flow@v3alpha eval export` produces valid JSON
- [ ] All unit and integration tests pass
- [ ] TypeScript compiles without errors
