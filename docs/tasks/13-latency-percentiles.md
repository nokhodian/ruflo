# Task 13: Latency Percentile Monitoring Per Agent
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Low  
**Depends on:** Task 12 (Trace Hierarchy — `TraceStore` with `agent_spans` table must exist)  
**Blocks:** None

---

## 1. Current State

Agent execution latency is not tracked at all. The `AgentStatus` interface in `v3/mcp/tools/agent-tools.ts` exposes `averageExecutionTime` but this field is always `0` — no data is written to it.

**Relevant files:**
- `v3/mcp/tools/agent-tools.ts` — `AgentStatus.metrics.averageExecutionTime` (always 0)
- `v3/@claude-flow/hooks/src/observability/trace.ts` — `TraceStore` with `agent_spans` table (Task 12)
- `v3/@claude-flow/hooks/src/observability/trace.ts` — `agent_spans` columns: `started_at`, `ended_at`, `agent_slug`
- `v3/@claude-flow/hooks/src/daemons/index.ts` — `MetricsDaemon` (exists but unconnected to spans)

**SQLite table from Task 12 (`agent_spans`):**
```sql
span_id, trace_id, parent_span_id, agent_slug,
started_at, ended_at, input_tokens, output_tokens,
cost_usd, retry_count, status, error_message
```

**What is missing:**
- `latency_ms` derived column (or computed as `ended_at - started_at`)
- `LatencyReporter` class that queries percentiles from `agent_spans`
- CLI command `npx claude-flow@v3alpha metrics latency --agent <slug>`
- MCP tool `metrics/latency` for programmatic access
- Alert threshold check that logs a warning when p95 > configured threshold

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No percentile query | Tail latency problems invisible until pipeline stalls |
| No alert threshold | Silent p99 spikes block swarm orchestration |
| No CLI command | Cannot inspect latency without writing ad-hoc SQL |
| No MCP tool | Agents cannot self-report whether they are running slow |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/observability/latency-reporter.ts` | Queries `agent_spans` table for p50/p95/p99 per agent per time window; emits alert if p95 exceeds threshold |
| `v3/@claude-flow/cli/src/commands/metrics.ts` | CLI command `metrics latency` with `--agent`, `--period`, `--format` flags |
| `v3/mcp/tools/metrics-tools.ts` | MCP tool `metrics/latency` returning `LatencyReport` |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/@claude-flow/hooks/src/observability/index.ts` | Export `LatencyReporter` and `LatencyReport` | External access |
| `v3/@claude-flow/hooks/src/index.ts` | Re-export from observability | Package consumers |
| `v3/mcp/tools/index.ts` | Add `metricsTools` | MCP registration |
| `v3/@claude-flow/cli/src/commands/index.ts` | Register `metrics` command | CLI registration |

---

## 5. Implementation Steps

**Step 1 — Create `v3/@claude-flow/hooks/src/observability/latency-reporter.ts`**

```typescript
import type Database from 'better-sqlite3';
import { TraceStore } from './trace.js';

export interface AgentLatencyStats {
  agentSlug: string;
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgMs: number;
  windowHours: number;
}

export interface LatencyReport {
  generatedAt: number;
  windowHours: number;
  agents: AgentLatencyStats[];
  alerts: LatencyAlert[];
}

export interface LatencyAlert {
  agentSlug: string;
  metric: 'p95' | 'p99';
  observedMs: number;
  thresholdMs: number;
  severity: 'warning' | 'critical';
}

export interface LatencyThreshold {
  agentSlug: string;       // '*' matches all agents
  p95ThresholdMs: number;
  p99ThresholdMs?: number;
}

/**
 * SQLite does not have PERCENTILE_CONT.
 * We compute percentiles in-process from the sorted latency array.
 */
function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(pct * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export class LatencyReporter {
  constructor(
    private readonly db: Database.Database,
    private readonly thresholds: LatencyThreshold[] = []
  ) {}

  /** Build a full latency report for the given time window */
  report(windowHours = 24): LatencyReport {
    const cutoff = Date.now() - windowHours * 3_600_000;

    const rows = this.db.prepare(`
      SELECT
        agent_slug,
        (ended_at - started_at) AS latency_ms
      FROM agent_spans
      WHERE started_at > ?
        AND ended_at IS NOT NULL
        AND status != 'running'
      ORDER BY agent_slug, latency_ms ASC
    `).all(cutoff) as Array<{ agent_slug: string; latency_ms: number }>;

    // Group by agent_slug
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const list = groups.get(row.agent_slug) ?? [];
      list.push(row.latency_ms);
      groups.set(row.agent_slug, list);
    }

    const agents: AgentLatencyStats[] = [];
    const alerts: LatencyAlert[] = [];

    for (const [slug, latencies] of groups) {
      latencies.sort((a, b) => a - b);
      const stats: AgentLatencyStats = {
        agentSlug: slug,
        sampleCount: latencies.length,
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
        p99Ms: percentile(latencies, 0.99),
        maxMs: latencies[latencies.length - 1],
        avgMs: Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length),
        windowHours,
      };
      agents.push(stats);

      // Check thresholds
      const threshold =
        this.thresholds.find(t => t.agentSlug === slug) ??
        this.thresholds.find(t => t.agentSlug === '*');

      if (threshold) {
        if (stats.p95Ms > threshold.p95ThresholdMs) {
          alerts.push({
            agentSlug: slug,
            metric: 'p95',
            observedMs: stats.p95Ms,
            thresholdMs: threshold.p95ThresholdMs,
            severity: stats.p95Ms > threshold.p95ThresholdMs * 2 ? 'critical' : 'warning',
          });
        }
        if (threshold.p99ThresholdMs && stats.p99Ms > threshold.p99ThresholdMs) {
          alerts.push({
            agentSlug: slug,
            metric: 'p99',
            observedMs: stats.p99Ms,
            thresholdMs: threshold.p99ThresholdMs,
            severity: 'critical',
          });
        }
      }
    }

    // Sort by p95 descending (worst offenders first)
    agents.sort((a, b) => b.p95Ms - a.p95Ms);

    return { generatedAt: Date.now(), windowHours, agents, alerts };
  }

  /** Narrow report for a single agent */
  reportAgent(agentSlug: string, windowHours = 24): AgentLatencyStats | undefined {
    const full = this.report(windowHours);
    return full.agents.find(a => a.agentSlug === agentSlug);
  }
}

/**
 * Factory: build a LatencyReporter from an existing TraceStore.
 * TraceStore exposes its db via a getter added in this task.
 */
export function createLatencyReporter(
  store: TraceStore,
  thresholds: LatencyThreshold[] = []
): LatencyReporter {
  return new LatencyReporter((store as any).db, thresholds);
}
```

**Step 2 — Expose `db` getter on `TraceStore` (edit `trace.ts` from Task 12)**

In `TraceStore`, add:
```typescript
/** Exposed for LatencyReporter — do not write directly */
get database(): Database.Database {
  return this.db;
}
```

Update `createLatencyReporter` in `latency-reporter.ts` to use:
```typescript
export function createLatencyReporter(
  store: TraceStore,
  thresholds: LatencyThreshold[] = []
): LatencyReporter {
  return new LatencyReporter(store.database, thresholds);
}
```

**Step 3 — Create `v3/mcp/tools/metrics-tools.ts`**

```typescript
import { z } from 'zod';
import { MCPTool } from '../types.js';
import { createLatencyReporter, type LatencyReporter } from '@claude-flow/hooks';

let _reporter: LatencyReporter | null = null;
export function setLatencyReporter(r: LatencyReporter): void { _reporter = r; }

function getReporter(): LatencyReporter {
  if (!_reporter) throw new Error('LatencyReporter not initialized');
  return _reporter;
}

export const metricsLatencyTool: MCPTool = {
  name: 'metrics/latency',
  description: 'Get p50/p95/p99 latency statistics per agent for a given time window',
  inputSchema: {
    type: 'object',
    properties: {
      agentSlug:   { type: 'string', description: 'Filter to a single agent slug (omit for all agents)' },
      windowHours: { type: 'number', description: 'Lookback window in hours (default: 24)', default: 24 },
    },
  },
  handler: async (input) => {
    const schema = z.object({
      agentSlug:   z.string().optional(),
      windowHours: z.number().positive().default(24),
    });
    const { agentSlug, windowHours } = schema.parse(input);
    const reporter = getReporter();

    if (agentSlug) {
      const stats = reporter.reportAgent(agentSlug, windowHours);
      return stats ?? { error: `No data for agent: ${agentSlug}` };
    }
    return reporter.report(windowHours);
  },
  category: 'observability',
  tags: ['metrics', 'latency', 'observability'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 30_000,
};

export const metricsTools: MCPTool[] = [metricsLatencyTool];
export default metricsTools;
```

**Step 4 — Create `v3/@claude-flow/cli/src/commands/metrics.ts`**

```typescript
import { Command } from 'commander';
import { TraceStore, createLatencyReporter } from '@claude-flow/hooks';

export function buildMetricsCommand(): Command {
  const cmd = new Command('metrics');
  cmd.description('Agent observability metrics');

  cmd
    .command('latency')
    .description('Show p50/p95/p99 latency per agent')
    .option('--agent <slug>', 'Filter to specific agent')
    .option('--period <hours>', 'Lookback window in hours', '24')
    .option('--format <fmt>', 'Output format: table | json', 'table')
    .option('--alert-p95 <ms>', 'Warn if p95 exceeds this threshold (ms)')
    .action(async (opts) => {
      const dbPath = process.env.TRACE_DB_PATH ?? './data/observability/traces.db';
      const store = new TraceStore(dbPath);
      const thresholds = opts.alertP95
        ? [{ agentSlug: '*', p95ThresholdMs: Number(opts.alertP95) }]
        : [];
      const reporter = createLatencyReporter(store, thresholds);
      const windowHours = Number(opts.period);
      const report = reporter.report(windowHours);

      if (opts.format === 'json') {
        console.log(JSON.stringify(report, null, 2));
        store.close();
        return;
      }

      // Table output
      const filtered = opts.agent
        ? report.agents.filter(a => a.agentSlug === opts.agent)
        : report.agents;

      if (filtered.length === 0) {
        console.log('No data for the given window.');
        store.close();
        return;
      }

      const header = 'Agent Slug                         | Samples | p50ms | p95ms | p99ms | max';
      const divider = '-'.repeat(header.length);
      console.log(header);
      console.log(divider);
      for (const a of filtered) {
        const slug = a.agentSlug.padEnd(35);
        console.log(
          `${slug} | ${String(a.sampleCount).padStart(7)} | ${String(a.p50Ms).padStart(5)} | ${String(a.p95Ms).padStart(5)} | ${String(a.p99Ms).padStart(5)} | ${a.maxMs}`
        );
      }

      if (report.alerts.length > 0) {
        console.log('\n[ALERTS]');
        for (const alert of report.alerts) {
          console.warn(
            `  [${alert.severity.toUpperCase()}] ${alert.agentSlug} ${alert.metric}=${alert.observedMs}ms > threshold ${alert.thresholdMs}ms`
          );
        }
      }

      store.close();
    });

  return cmd;
}
```

**Step 5 — Register CLI command**

In `v3/@claude-flow/cli/src/commands/index.ts`, add:
```typescript
import { buildMetricsCommand } from './metrics.js';
program.addCommand(buildMetricsCommand());
```

**Step 6 — Update observability index exports**

In `v3/@claude-flow/hooks/src/observability/index.ts`, add:
```typescript
export {
  LatencyReporter,
  createLatencyReporter,
  type AgentLatencyStats,
  type LatencyReport,
  type LatencyAlert,
  type LatencyThreshold,
} from './latency-reporter.js';
```

---

## 6. Key Code Templates

### LatencyReport shape (returned by `metrics/latency` MCP tool)
```typescript
{
  generatedAt: 1743936000000,
  windowHours: 24,
  agents: [
    {
      agentSlug: "engineering-security-engineer",
      sampleCount: 47,
      p50Ms: 3200,
      p95Ms: 8900,
      p99Ms: 14200,
      maxMs: 18400,
      avgMs: 3800,
      windowHours: 24
    }
  ],
  alerts: [
    {
      agentSlug: "engineering-security-engineer",
      metric: "p95",
      observedMs: 8900,
      thresholdMs: 5000,
      severity: "warning"
    }
  ]
}
```

### CLI usage
```bash
npx claude-flow@v3alpha metrics latency --period 24 --format table
npx claude-flow@v3alpha metrics latency --agent engineering-security-engineer
npx claude-flow@v3alpha metrics latency --alert-p95 5000 --format json
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/hooks/src/observability/latency-reporter.test.ts`**
```typescript
describe('LatencyReporter', () => {
  it('computes p50/p95/p99 correctly from sorted array', () => {
    // percentile([100, 200, 300, 400, 500], 0.95) should return 500 (index 4)
  });
  it('returns empty agents array when no spans in window', () => { ... });
  it('generates an alert when p95 exceeds threshold', () => { ... });
  it('sorts agents by p95 descending', () => { ... });
  it('reportAgent returns undefined for unknown agent', () => { ... });
});
```

**Integration:**
- Insert 20 `agent_spans` rows for `engineering-security-engineer` with known latencies
- Call `reporter.report(24)`
- Assert p50, p95, p99 match expected values

**CLI test:**
```bash
TRACE_DB_PATH=./test-data/traces.db npx claude-flow@v3alpha metrics latency --format json | jq '.agents | length'
```

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/hooks/src/observability/latency-reporter.ts` compiles
- [ ] `createLatencyReporter` factory function exported from hooks package
- [ ] `TraceStore.database` getter added to `trace.ts` (Task 12 file)
- [ ] `metrics/latency` MCP tool registered and returns `LatencyReport` shape
- [ ] `npx claude-flow@v3alpha metrics latency` CLI command works end-to-end
- [ ] p50/p95/p99 computed correctly (unit test with known data passes)
- [ ] Alert fires when p95 > threshold
- [ ] `--format json` outputs valid JSON
- [ ] No `any` in public API
