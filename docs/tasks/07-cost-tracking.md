# Task 07: Per-Agent Cost + Token Tracking

**Priority:** Phase 1 — Foundation  
**Effort:** Low  
**Depends on:** none  
**Blocks:** none (enhances observability; Task 06 wires onRetry callback to this)

---

## 1. Current State

There is no per-agent cost or token tracking anywhere in ruflo. The improvement plan (IMP-021) classifies this as 🔴 Critical.

**Existing hook infrastructure** at `v3/@claude-flow/hooks/src/`:
- `hooks/` — contains hook handler files (pre-task, post-task, session-start, etc.)
- `workers/` — contains worker files
- `index.ts` — main export

The `post-task` hook is the natural integration point. Read `v3/@claude-flow/hooks/src/hooks/` to find the post-task hook file.

**Existing memory/storage** at `v3/@claude-flow/memory/src/`:
- `sqlite-backend.ts` — SQLite storage implementation
- `sqljs-backend.ts` — sql.js WASM-based SQLite
- `agentdb-adapter.ts` — AgentDB adapter

**CLI commands** at `v3/@claude-flow/cli/src/commands/`:
- `performance.ts` — performance CLI (benchmarks, profiling)
- No `cost.ts` command exists yet

The improvement plan specifies this SQL schema:
```sql
CREATE TABLE agent_cost_records (
  id           TEXT PRIMARY KEY,
  agent_slug   TEXT NOT NULL,
  task_type    TEXT,
  task_id      TEXT,
  model        TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd     REAL,
  latency_ms   INTEGER,
  retry_count  INTEGER DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 2. Gap Analysis

**What is missing:**

1. **No `agent_cost_records` table.** No SQLite schema for storing per-call cost data.
2. **No `CostTracker` class.** No component that accepts `(agentSlug, model, inputTokens, outputTokens, latencyMs, retryCount)` and persists it.
3. **No `post-task` hook integration.** The hook runs after each agent task but does not emit cost data.
4. **No cost report CLI command.** `npx claude-flow@v3alpha cost report` does not exist.
5. **No budget alert system.** No per-agent `max_cost_per_call` enforcement.
6. **Token counting** is not extracted from Claude API responses. The API returns `usage: { input_tokens, output_tokens }` — this must be captured and passed to the tracker.

**Failure modes without this task:**
- Unable to answer "which agent is costing the most?" — blocks cost optimization
- Retries from Task 06 are invisible from a cost perspective
- No data for prompt optimization (Task IMP-036) which needs quality + cost data
- Cannot enforce per-agent cost budgets

---

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/hooks/src/cost/cost-tracker.ts` | `CostTracker` class — records cost data to SQLite |
| `v3/@claude-flow/hooks/src/cost/cost-schema.ts` | SQL DDL for `agent_cost_records` table, migration helper |
| `v3/@claude-flow/hooks/src/cost/cost-reporter.ts` | `CostReporter` class — queries and formats cost reports |
| `v3/@claude-flow/hooks/src/cost/model-pricing.ts` | Price per 1M tokens per model (Haiku, Sonnet, Opus) |
| `v3/@claude-flow/hooks/src/cost/index.ts` | Barrel export for the cost module |
| `v3/@claude-flow/cli/src/commands/cost.ts` | `cost` CLI command with `report` and `budget` subcommands |
| `tests/hooks/cost-tracker.test.ts` | Unit tests for CostTracker (SQLite in-memory) |
| `tests/hooks/cost-reporter.test.ts` | Unit tests for CostReporter |

---

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/@claude-flow/hooks/src/hooks/post-task.ts` | Read this file first. Add call to `CostTracker.record()` with token usage data extracted from the completed task. |
| `v3/@claude-flow/hooks/src/index.ts` | Export `CostTracker`, `CostReporter` from the cost module |
| `v3/@claude-flow/cli/src/commands/index.ts` | Register the new `cost` command |

---

## 5. Implementation Steps

### Step 1: Read the post-task hook and memory backend

Before creating any new files:
1. Read `v3/@claude-flow/hooks/src/hooks/post-task.ts` (or the correct path — check `v3/@claude-flow/hooks/src/hooks/` directory)
2. Read `v3/@claude-flow/memory/src/sqlite-backend.ts` to understand the SQLite API used in the project
3. Read `v3/@claude-flow/memory/src/sqljs-backend.ts` for the sql.js API

### Step 2: Create model pricing data

Create `v3/@claude-flow/hooks/src/cost/model-pricing.ts` — see Section 6.

This is a pure lookup table. No I/O.

### Step 3: Create the SQL schema file

Create `v3/@claude-flow/hooks/src/cost/cost-schema.ts` — see Section 6.

Contains:
- `CREATE_TABLE_SQL` — the DDL for `agent_cost_records`
- `CREATE_INDEXES_SQL` — index creation statements
- `migrateSchema(db)` — runs DDL idempotently (CREATE TABLE IF NOT EXISTS)

### Step 4: Create `CostTracker`

Create `v3/@claude-flow/hooks/src/cost/cost-tracker.ts` — see Section 6.

`CostTracker` must:
- Accept a database path in its constructor (use the same SQLite backend as the rest of the project)
- Call `migrateSchema()` on first use
- Provide `record(entry: CostRecord): Promise<void>`
- Provide `getBudgetAlert(agentSlug: string, maxCostUsd: number): Promise<BudgetAlert | null>` — checks if this agent has exceeded budget in the last 24h

### Step 5: Create `CostReporter`

Create `v3/@claude-flow/hooks/src/cost/cost-reporter.ts` — see Section 6.

`CostReporter` provides:
- `report(options: ReportOptions): Promise<CostReport>` — aggregates by agent, period, model
- `topByAgent(limit: number, periodDays: number): Promise<AgentCostSummary[]>`
- `retryStats(periodDays: number): Promise<RetryStats>` — cost attributable to retries (Task 06)

### Step 6: Modify the post-task hook

Read `v3/@claude-flow/hooks/src/hooks/post-task.ts` first.

The post-task hook receives task completion data. Add CostTracker integration. The hook data should already have `agentSlug`, `taskId`, `model`, `inputTokens`, `outputTokens`, `latencyMs`. If token data is not in the hook payload yet, add it to the hook input schema.

### Step 7: Create the cost CLI command

Create `v3/@claude-flow/cli/src/commands/cost.ts` — see Section 6.

Subcommands:
- `cost report [--group-by agent|model|task-type] [--period 1d|7d|30d] [--format table|json]`
- `cost budget set --agent <slug> --max-cost-usd <amount>`
- `cost budget list`

### Step 8: Register cost command in CLI

Read `v3/@claude-flow/cli/src/commands/index.ts`. Add the cost command registration.

### Step 9: Write tests

Create `tests/hooks/cost-tracker.test.ts` and `tests/hooks/cost-reporter.test.ts` — see Section 7.

---

## 6. Key Code Templates

### `v3/@claude-flow/hooks/src/cost/model-pricing.ts`
```typescript
/**
 * Claude API pricing per 1M tokens (USD).
 * Last updated: 2026-04. Verify at https://www.anthropic.com/pricing.
 */
export interface ModelPrice {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-haiku-4':       { inputPer1M: 0.80,   outputPer1M: 4.00 },
  'claude-haiku-3':       { inputPer1M: 0.25,   outputPer1M: 1.25 },
  'claude-sonnet-4':      { inputPer1M: 3.00,   outputPer1M: 15.00 },
  'claude-sonnet-3.7':    { inputPer1M: 3.00,   outputPer1M: 15.00 },
  'claude-opus-4':        { inputPer1M: 15.00,  outputPer1M: 75.00 },
  'claude-opus-3':        { inputPer1M: 15.00,  outputPer1M: 75.00 },
};

const FALLBACK_PRICING: ModelPrice = { inputPer1M: 3.00, outputPer1M: 15.00 };

/**
 * Calculate cost in USD for a single API call.
 */
export function calculateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // Normalize model name: strip dates like "claude-haiku-3-20250307"
  const normalized = Object.keys(MODEL_PRICING).find(key =>
    model.toLowerCase().startsWith(key.toLowerCase())
  ) ?? model;

  const pricing = MODEL_PRICING[normalized] ?? FALLBACK_PRICING;
  return (
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M
  );
}
```

### `v3/@claude-flow/hooks/src/cost/cost-schema.ts`
```typescript
/** SQL DDL for cost tracking table */
export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS agent_cost_records (
  id            TEXT PRIMARY KEY,
  agent_slug    TEXT NOT NULL,
  task_type     TEXT,
  task_id       TEXT,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL,
  latency_ms    INTEGER,
  retry_count   INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
)
`;

export const CREATE_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_cost_agent_slug ON agent_cost_records(agent_slug)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_task_type  ON agent_cost_records(task_type)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_created_at ON agent_cost_records(created_at)`,
];

export interface CostRecord {
  id: string;
  agentSlug: string;
  taskType?: string;
  taskId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  latencyMs?: number;
  retryCount?: number;
}
```

### `v3/@claude-flow/hooks/src/cost/cost-tracker.ts`
```typescript
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3'; // or use the sql.js backend already in the project
import {
  CREATE_TABLE_SQL,
  CREATE_INDEXES_SQL,
  CostRecord,
} from './cost-schema.js';
import { calculateCostUsd } from './model-pricing.js';

export interface BudgetAlert {
  agentSlug: string;
  totalCostUsd: number;
  maxCostUsd: number;
  exceedance: number;
}

export interface CostTrackerConfig {
  /** Path to SQLite database file */
  dbPath: string;
}

/**
 * Records per-agent cost data to SQLite.
 * Thread-safe via WAL mode.
 *
 * NOTE: If the project already uses sqljs-backend.ts or sqlite-backend.ts,
 * use those instead of better-sqlite3. Read those files first to determine
 * the correct import and API to use.
 */
export class CostTracker {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(config: CostTrackerConfig) {
    this.dbPath = config.dbPath;
  }

  private ensureDb(): Database.Database {
    if (this.db) return this.db;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(CREATE_TABLE_SQL);
    for (const sql of CREATE_INDEXES_SQL) {
      this.db.exec(sql);
    }
    return this.db;
  }

  /**
   * Record a cost entry.
   * costUsd is computed from model pricing if not provided.
   */
  record(entry: CostRecord): void {
    const db = this.ensureDb();
    const costUsd = entry.costUsd ?? calculateCostUsd(
      entry.model,
      entry.inputTokens,
      entry.outputTokens
    );

    db.prepare(`
      INSERT INTO agent_cost_records
        (id, agent_slug, task_type, task_id, model,
         input_tokens, output_tokens, cost_usd, latency_ms, retry_count)
      VALUES
        (@id, @agentSlug, @taskType, @taskId, @model,
         @inputTokens, @outputTokens, @costUsd, @latencyMs, @retryCount)
    `).run({
      id: entry.id || randomBytes(8).toString('hex'),
      agentSlug: entry.agentSlug,
      taskType: entry.taskType ?? null,
      taskId: entry.taskId ?? null,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costUsd,
      latencyMs: entry.latencyMs ?? null,
      retryCount: entry.retryCount ?? 0,
    });
  }

  /**
   * Check if an agent has exceeded its budget in the last 24 hours.
   */
  checkBudget(agentSlug: string, maxCostUsd: number): BudgetAlert | null {
    const db = this.ensureDb();
    const row = db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) AS total
      FROM agent_cost_records
      WHERE agent_slug = @agentSlug
        AND created_at >= datetime('now', '-24 hours')
    `).get({ agentSlug }) as { total: number };

    if (row.total > maxCostUsd) {
      return {
        agentSlug,
        totalCostUsd: row.total,
        maxCostUsd,
        exceedance: row.total - maxCostUsd,
      };
    }
    return null;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
```

### `v3/@claude-flow/hooks/src/cost/cost-reporter.ts`
```typescript
import Database from 'better-sqlite3';
import { CREATE_TABLE_SQL, CREATE_INDEXES_SQL } from './cost-schema.js';

export interface ReportOptions {
  periodDays?: number;   // default: 7
  groupBy?: 'agent' | 'model' | 'task_type';
  limit?: number;        // default: 20
}

export interface AgentCostSummary {
  agentSlug: string;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number | null;
  totalRetries: number;
}

export interface CostReport {
  periodDays: number;
  generatedAt: string;
  totalCostUsd: number;
  totalCalls: number;
  byAgent: AgentCostSummary[];
}

export class CostReporter {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
  }

  report(options: ReportOptions = {}): CostReport {
    const { periodDays = 7, limit = 20 } = options;

    const total = this.db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) AS totalCostUsd,
             COUNT(*) AS totalCalls
      FROM agent_cost_records
      WHERE created_at >= datetime('now', @period)
    `).get({ period: `-${periodDays} days` }) as { totalCostUsd: number; totalCalls: number };

    const byAgent = this.db.prepare(`
      SELECT
        agent_slug AS agentSlug,
        COUNT(*) AS totalCalls,
        SUM(input_tokens) AS totalInputTokens,
        SUM(output_tokens) AS totalOutputTokens,
        COALESCE(SUM(cost_usd), 0) AS totalCostUsd,
        AVG(latency_ms) AS avgLatencyMs,
        COALESCE(SUM(retry_count), 0) AS totalRetries
      FROM agent_cost_records
      WHERE created_at >= datetime('now', @period)
      GROUP BY agent_slug
      ORDER BY totalCostUsd DESC
      LIMIT @limit
    `).all({ period: `-${periodDays} days`, limit }) as AgentCostSummary[];

    return {
      periodDays,
      generatedAt: new Date().toISOString(),
      totalCostUsd: total.totalCostUsd,
      totalCalls: total.totalCalls,
      byAgent,
    };
  }

  close(): void {
    this.db.close();
  }
}
```

### `v3/@claude-flow/cli/src/commands/cost.ts`
```typescript
import { Command } from 'commander';
import { CostReporter } from '../../../@claude-flow/hooks/src/cost/cost-reporter.js';
import { resolve } from 'path';

const DEFAULT_DB_PATH = resolve('./data/memory/cost.db');

export function createCostCommand(): Command {
  const cmd = new Command('cost').description('Cost tracking and budget management');

  cmd
    .command('report')
    .description('Show cost report grouped by agent')
    .option('--period <days>', 'Period in days (1, 7, 30)', '7')
    .option('--format <format>', 'Output format: table or json', 'table')
    .option('--limit <n>', 'Max agents to show', '20')
    .option('--db <path>', 'Database path', DEFAULT_DB_PATH)
    .action((options) => {
      const reporter = new CostReporter(options.db);
      const report = reporter.report({
        periodDays: parseInt(options.period, 10),
        limit: parseInt(options.limit, 10),
      });
      reporter.close();

      if (options.format === 'json') {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      // Table format
      console.log(`\nCost Report — Last ${report.periodDays} days`);
      console.log(`Generated: ${report.generatedAt}`);
      console.log(`Total: $${report.totalCostUsd.toFixed(6)} USD across ${report.totalCalls} calls\n`);

      const rows = report.byAgent.map(a => ({
        Agent: a.agentSlug,
        Calls: a.totalCalls,
        'Cost (USD)': `$${a.totalCostUsd.toFixed(6)}`,
        'Input Tok': a.totalInputTokens.toLocaleString(),
        'Output Tok': a.totalOutputTokens.toLocaleString(),
        Retries: a.totalRetries,
        'Avg Latency': a.avgLatencyMs ? `${Math.round(a.avgLatencyMs)}ms` : '-',
      }));

      console.table(rows);
    });

  return cmd;
}
```

---

## 7. Testing Strategy

### Unit Tests (`tests/hooks/cost-tracker.test.ts`)

```typescript
import { CostTracker } from '../../v3/@claude-flow/hooks/src/cost/cost-tracker.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let tracker: CostTracker;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ruflo-cost-test-'));
  tracker = new CostTracker({ dbPath: join(tmpDir, 'test.db') });
});

afterEach(() => {
  tracker.close();
  rmSync(tmpDir, { recursive: true });
});

describe('CostTracker', () => {
  describe('record()', () => {
    it('records a cost entry without throwing', () => {
      expect(() => tracker.record({
        id: 'test-001',
        agentSlug: 'coder',
        model: 'claude-haiku-3',
        inputTokens: 1000,
        outputTokens: 500,
      })).not.toThrow();
    });

    it('auto-calculates costUsd when not provided', () => {
      tracker.record({
        id: 'test-002',
        agentSlug: 'coder',
        model: 'claude-haiku-3',
        inputTokens: 1_000_000, // 1M tokens = $0.25
        outputTokens: 0,
      });
      const alert = tracker.checkBudget('coder', 0.20);
      expect(alert).not.toBeNull(); // $0.25 > $0.20
    });

    it('records retry count', () => {
      tracker.record({
        id: 'test-003',
        agentSlug: 'reviewer',
        model: 'claude-sonnet-4',
        inputTokens: 2000,
        outputTokens: 1000,
        retryCount: 2,
      });
      // Will be visible in reporter query
    });
  });

  describe('checkBudget()', () => {
    it('returns null when under budget', () => {
      tracker.record({
        id: 'b-001',
        agentSlug: 'cheap-agent',
        model: 'claude-haiku-3',
        inputTokens: 100,
        outputTokens: 50,
      });
      const alert = tracker.checkBudget('cheap-agent', 10.00);
      expect(alert).toBeNull();
    });

    it('returns BudgetAlert when over budget', () => {
      tracker.record({
        id: 'b-002',
        agentSlug: 'expensive-agent',
        model: 'claude-opus-4',
        inputTokens: 1_000_000, // $15
        outputTokens: 0,
      });
      const alert = tracker.checkBudget('expensive-agent', 5.00);
      expect(alert).not.toBeNull();
      expect(alert!.agentSlug).toBe('expensive-agent');
      expect(alert!.totalCostUsd).toBeGreaterThan(5.00);
    });
  });
});
```

### Unit Tests (`tests/hooks/cost-reporter.test.ts`)

```typescript
import { CostTracker } from '../../v3/@claude-flow/hooks/src/cost/cost-tracker.js';
import { CostReporter } from '../../v3/@claude-flow/hooks/src/cost/cost-reporter.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ruflo-reporter-test-'));
  dbPath = join(tmpDir, 'test.db');
  // Seed test data using CostTracker
  const tracker = new CostTracker({ dbPath });
  tracker.record({ id: 'r1', agentSlug: 'coder', model: 'claude-haiku-3',
    inputTokens: 1000, outputTokens: 500, taskType: 'feature-development', retryCount: 0 });
  tracker.record({ id: 'r2', agentSlug: 'reviewer', model: 'claude-sonnet-4',
    inputTokens: 2000, outputTokens: 1000, taskType: 'code-review', retryCount: 1 });
  tracker.record({ id: 'r3', agentSlug: 'coder', model: 'claude-haiku-3',
    inputTokens: 800, outputTokens: 400, taskType: 'bug-fix', retryCount: 2 });
  tracker.close();
});

afterEach(() => rmSync(tmpDir, { recursive: true }));

describe('CostReporter', () => {
  let reporter: CostReporter;
  beforeEach(() => { reporter = new CostReporter(dbPath); });
  afterEach(() => reporter.close());

  describe('report()', () => {
    it('returns a CostReport with correct structure', () => {
      const report = reporter.report();
      expect(report).toHaveProperty('periodDays');
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('totalCostUsd');
      expect(report).toHaveProperty('totalCalls');
      expect(report).toHaveProperty('byAgent');
    });

    it('counts all calls in period', () => {
      const report = reporter.report({ periodDays: 7 });
      expect(report.totalCalls).toBe(3);
    });

    it('groups by agent with correct call counts', () => {
      const report = reporter.report();
      const coderSummary = report.byAgent.find(a => a.agentSlug === 'coder');
      expect(coderSummary).toBeDefined();
      expect(coderSummary!.totalCalls).toBe(2);
    });

    it('sums retry counts per agent', () => {
      const report = reporter.report();
      const coderSummary = report.byAgent.find(a => a.agentSlug === 'coder');
      expect(coderSummary!.totalRetries).toBe(2); // 0 + 2
    });

    it('orders by totalCostUsd descending', () => {
      const report = reporter.report();
      if (report.byAgent.length >= 2) {
        expect(report.byAgent[0].totalCostUsd).toBeGreaterThanOrEqual(
          report.byAgent[1].totalCostUsd
        );
      }
    });
  });
});
```

### Model Pricing Tests

```typescript
import { calculateCostUsd } from '../../v3/@claude-flow/hooks/src/cost/model-pricing.js';

describe('calculateCostUsd', () => {
  it('calculates haiku-3 input cost correctly', () => {
    // 1M input tokens at $0.25/1M = $0.25
    expect(calculateCostUsd('claude-haiku-3', 1_000_000, 0)).toBeCloseTo(0.25, 4);
  });

  it('calculates sonnet-4 output cost correctly', () => {
    // 1M output tokens at $15/1M = $15
    expect(calculateCostUsd('claude-sonnet-4', 0, 1_000_000)).toBeCloseTo(15.0, 2);
  });

  it('handles unknown model with fallback pricing', () => {
    const cost = calculateCostUsd('unknown-model', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('returns 0 for zero tokens', () => {
    expect(calculateCostUsd('claude-haiku-3', 0, 0)).toBe(0);
  });
});
```

---

## 8. Definition of Done

- [ ] `agent_cost_records` table created in SQLite with all 10 columns from the improvement plan schema
- [ ] Three indexes created: on `agent_slug`, `task_type`, and `created_at`
- [ ] `CostTracker.record()` persists entries with auto-computed `cost_usd` when not provided
- [ ] `calculateCostUsd()` produces correct costs for haiku-3, sonnet-4, opus-4 (verified against pricing table)
- [ ] `CostTracker.checkBudget()` returns `BudgetAlert` when 24h total exceeds limit, `null` otherwise
- [ ] `CostReporter.report()` returns aggregated data grouped by agent, ordered by cost descending
- [ ] `CostReporter` includes `totalRetries` per agent in summaries
- [ ] `npx claude-flow@v3alpha cost report` prints a table with: Agent, Calls, Cost (USD), Input Tok, Output Tok, Retries, Avg Latency
- [ ] `npx claude-flow@v3alpha cost report --format json` outputs valid JSON
- [ ] Post-task hook calls `CostTracker.record()` after each agent task completes
- [ ] Task 06's `onRetry` callback signature is compatible with cost tracking (receives attempt number)
- [ ] All unit tests pass (CostTracker + CostReporter + calculateCostUsd)
- [ ] No TypeScript `any` types
- [ ] All files under 500 lines
- [ ] Cost database is separate from the main AgentDB (separate `data/memory/cost.db` path)
