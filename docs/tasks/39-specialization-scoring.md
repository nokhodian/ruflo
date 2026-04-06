# Task 39: Agent Specialization Scoring
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Low
**Depends on:** Task 30 (Agent Registry — provides task-type metadata), Task 33 (Eval Datasets — provides outcome data)
**Blocks:** (none)

## 1. Current State

When multiple agents could handle a task, ruflo has no mechanism to prefer the agent that historically succeeds at that specific task type. Agent selection is purely based on the hardcoded routing codes 1–13 in `.agents/skills/agent-coordination/SKILL.md` or on explicit `agentType` parameters in `agent/spawn` calls.

No per-agent success/failure tracking exists. There is no `agent_specialization_scores` table in AgentDB (`v3/@claude-flow/memory/src/agentdb-backend.ts`). The `post-task` hook fires success/failure events but they are not aggregated into per-agent-per-task-type statistics.

The hooks background workers (`v3/@claude-flow/hooks/src/workers/`) include `ultralearn` and `consolidate` workers but neither produces specialization scores.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB schema
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/` — background workers
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `handleSpawnAgent`
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/registry.json` — task-type metadata (Task 30)

## 2. Gap Analysis

**What's missing:**
1. No `agent_specialization_scores` table — no historical performance data per agent per task type
2. No score update logic — `post-task` outcomes are not aggregated
3. No score query API — routing cannot consult historical performance
4. No time-decay mechanism — old performance data doesn't fade as agents are updated
5. No "prefer top scorer" logic in `handleSpawnAgent` — all agents are equally preferred when multiple match

**Concrete failure modes:**
- `engineering-backend-architect` and `engineering-software-architect` both match a task; ruflo picks randomly; the one with a 40% worse success rate on `api-design` tasks is chosen half the time
- An agent is updated with a degraded prompt (before Task 34 catches it); specialization scores would flag the regression via declining scores before the regression benchmark runs
- Routing codes 1–13 always pick the same agents; specialization scoring would allow dynamic preference based on observed performance

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/cli/src/agents/specialization-scorer.ts` | Updates scores on `post-task` events; queries scores for routing |
| `v3/@claude-flow/cli/src/agents/score-decay.ts` | Applies time-based decay to prevent stale scores from dominating |
| `v3/@claude-flow/cli/src/commands/scores.ts` | CLI: `scores show`, `scores top`, `scores reset` |
| `v3/@claude-flow/shared/src/types/specialization.ts` | `SpecializationScore`, `ScoreUpdate` TypeScript interfaces |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `agent_specialization_scores` table migration |
| `v3/@claude-flow/hooks/src/workers/mcp-tools.ts` | On `post-task` event, call `SpecializationScorer.recordOutcome()` |
| `v3/mcp/tools/agent-tools.ts` | In `handleSpawnAgent`, when multiple candidates exist, call `SpecializationScorer.topCandidate()` |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Register `scores` subcommand |

## 5. Implementation Steps

**Step 1: Define shared types**

Create `v3/@claude-flow/shared/src/types/specialization.ts`:

```typescript
export interface SpecializationScore {
  agentSlug: string;
  taskType: string;          // e.g. "security-audit", "api-design", "code-review"
  successCount: number;
  failureCount: number;
  totalCount: number;
  successRate: number;       // 0.0–1.0
  avgLatencyMs: number;
  avgQualityScore: number;   // 0.0–1.0, from eval traces (Task 33)
  lastUpdated: string;       // ISO 8601
  decayFactor: number;       // 0.0–1.0, applied during reads (older = lower)
  effectiveScore: number;    // successRate × decayFactor
}

export interface ScoreUpdate {
  agentSlug: string;
  taskType: string;
  success: boolean;
  latencyMs: number;
  qualityScore?: number;
}
```

**Step 2: Add AgentDB table**

In `v3/@claude-flow/memory/src/agentdb-backend.ts`:

```typescript
await db.exec(`
  CREATE TABLE IF NOT EXISTS agent_specialization_scores (
    agent_slug      TEXT    NOT NULL,
    task_type       TEXT    NOT NULL,
    success_count   INTEGER NOT NULL DEFAULT 0,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    total_latency_ms INTEGER NOT NULL DEFAULT 0,
    total_quality    REAL    NOT NULL DEFAULT 0,
    quality_count    INTEGER NOT NULL DEFAULT 0,
    last_updated    TEXT    NOT NULL,
    PRIMARY KEY (agent_slug, task_type)
  );

  CREATE INDEX IF NOT EXISTS idx_spec_scores_slug      ON agent_specialization_scores(agent_slug);
  CREATE INDEX IF NOT EXISTS idx_spec_scores_task_type ON agent_specialization_scores(task_type);
  CREATE INDEX IF NOT EXISTS idx_spec_scores_updated   ON agent_specialization_scores(last_updated);
`);
```

**Step 3: Implement SpecializationScorer**

Create `v3/@claude-flow/cli/src/agents/specialization-scorer.ts`:

```typescript
import type { SpecializationScore, ScoreUpdate } from '@claude-flow/shared/src/types/specialization.js';
import { calculateDecayFactor } from './score-decay.js';

export class SpecializationScorer {
  constructor(private db: AgentDBBackend) {}

  async recordOutcome(update: ScoreUpdate): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO agent_specialization_scores
         (agent_slug, task_type, success_count, failure_count, total_latency_ms,
          total_quality, quality_count, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_slug, task_type) DO UPDATE SET
         success_count    = success_count    + excluded.success_count,
         failure_count    = failure_count    + excluded.failure_count,
         total_latency_ms = total_latency_ms + excluded.total_latency_ms,
         total_quality    = total_quality    + excluded.total_quality,
         quality_count    = quality_count    + excluded.quality_count,
         last_updated     = excluded.last_updated`,
      [
        update.agentSlug,
        update.taskType,
        update.success ? 1 : 0,
        update.success ? 0 : 1,
        update.latencyMs,
        update.qualityScore ?? 0,
        update.qualityScore !== undefined ? 1 : 0,
        now,
      ]
    );
  }

  async getScore(agentSlug: string, taskType: string): Promise<SpecializationScore | null> {
    const row = await this.db.get(
      'SELECT * FROM agent_specialization_scores WHERE agent_slug = ? AND task_type = ?',
      [agentSlug, taskType]
    );
    if (!row) return null;
    return this.mapRow(row);
  }

  async getTopCandidates(taskType: string, slugs: string[], topN = 3): Promise<SpecializationScore[]> {
    if (slugs.length === 0) return [];
    const placeholders = slugs.map(() => '?').join(',');
    const rows = await this.db.all(
      `SELECT * FROM agent_specialization_scores
       WHERE task_type = ? AND agent_slug IN (${placeholders})
       ORDER BY last_updated DESC`,
      [taskType, ...slugs]
    );
    return rows
      .map(r => this.mapRow(r))
      .sort((a, b) => b.effectiveScore - a.effectiveScore)
      .slice(0, topN);
  }

  /** Pick the best slug from candidates; falls back to first candidate if no scores exist */
  async topCandidate(taskType: string, candidates: string[]): Promise<string> {
    const scored = await this.getTopCandidates(taskType, candidates, 1);
    return scored[0]?.agentSlug ?? candidates[0];
  }

  async getAllScores(agentSlug: string): Promise<SpecializationScore[]> {
    const rows = await this.db.all(
      'SELECT * FROM agent_specialization_scores WHERE agent_slug = ? ORDER BY task_type',
      [agentSlug]
    );
    return rows.map(r => this.mapRow(r));
  }

  async resetScores(agentSlug: string, taskType?: string): Promise<number> {
    const result = taskType
      ? await this.db.run(
          'DELETE FROM agent_specialization_scores WHERE agent_slug = ? AND task_type = ?',
          [agentSlug, taskType])
      : await this.db.run(
          'DELETE FROM agent_specialization_scores WHERE agent_slug = ?',
          [agentSlug]);
    return result.changes ?? 0;
  }

  private mapRow(row: any): SpecializationScore {
    const totalCount = row.success_count + row.failure_count;
    const successRate = totalCount > 0 ? row.success_count / totalCount : 0;
    const avgLatencyMs = totalCount > 0 ? row.total_latency_ms / totalCount : 0;
    const avgQualityScore = row.quality_count > 0 ? row.total_quality / row.quality_count : 0;
    const decayFactor = calculateDecayFactor(row.last_updated);
    return {
      agentSlug: row.agent_slug,
      taskType: row.task_type,
      successCount: row.success_count,
      failureCount: row.failure_count,
      totalCount,
      successRate,
      avgLatencyMs,
      avgQualityScore,
      lastUpdated: row.last_updated,
      decayFactor,
      effectiveScore: successRate * decayFactor,
    };
  }
}
```

**Step 4: Implement score decay**

Create `v3/@claude-flow/cli/src/agents/score-decay.ts`:

```typescript
/**
 * Time-based decay: scores from 90 days ago have 50% weight.
 * decay(t) = 0.5^(days_since_update / 90)
 *
 * This prevents agents from coasting on old good performance
 * after their prompts have been changed.
 */
export function calculateDecayFactor(lastUpdatedIso: string): number {
  const daysSince = (Date.now() - new Date(lastUpdatedIso).getTime()) / 86_400_000;
  return Math.pow(0.5, daysSince / 90);
}

/** Half-life in days for specialization score decay */
export const SCORE_HALF_LIFE_DAYS = 90;
```

**Step 5: Hook into post-task event**

In `v3/@claude-flow/hooks/src/workers/mcp-tools.ts`:

```typescript
import { SpecializationScorer } from '../../cli/src/agents/specialization-scorer.js';

async function handlePostTask(event: PostTaskEvent, ctx: WorkerContext): Promise<void> {
  // ... existing hook logic + Task 33 trace recording ...

  // Specialization scoring (Task 39)
  if (event.taskType && event.agentSlug) {
    const scorer = new SpecializationScorer(ctx.db);
    await scorer.recordOutcome({
      agentSlug: event.agentSlug,
      taskType: event.taskType,
      success: event.success,
      latencyMs: event.latencyMs ?? 0,
      qualityScore: event.qualityScore,
    });
  }
}
```

**Step 6: Integrate into handleSpawnAgent for multi-candidate routing**

In `v3/mcp/tools/agent-tools.ts`, in `handleSpawnAgent`:

```typescript
import { SpecializationScorer } from '../../@claude-flow/cli/src/agents/specialization-scorer.js';

async function handleSpawnAgent(input: SpawnAgentInput, ctx: ToolContext) {
  // If multiple candidates match (from routing/registry lookup) and taskType is known:
  if (input.config?.candidateAgents && input.config?.taskType) {
    const scorer = new SpecializationScorer(ctx.db);
    const bestSlug = await scorer.topCandidate(
      input.config.taskType as string,
      input.config.candidateAgents as string[]
    );
    // Override agentType with the highest-scoring candidate
    if (bestSlug !== input.agentType) {
      ctx.logger?.info(
        `[SpecializationScoring] Selected '${bestSlug}' over '${input.agentType}' for task type '${input.config.taskType}'`
      );
      input = { ...input, agentType: bestSlug as AgentType };
    }
  }
  // ... rest of spawn logic ...
}
```

**Step 7: CLI commands**

Create `v3/@claude-flow/cli/src/commands/scores.ts`:

```typescript
import { Command } from 'commander';
import { SpecializationScorer } from '../agents/specialization-scorer.js';

export function registerScoresCommand(program: Command): void {
  const cmd = program.command('scores').description('Agent specialization scores');

  cmd.command('show')
    .argument('<slug>', 'Agent slug')
    .option('--json')
    .action(async (slug, opts) => {
      const scorer = await getScorer();
      const scores = await scorer.getAllScores(slug);
      if (opts.json) { console.log(JSON.stringify(scores, null, 2)); return; }
      if (scores.length === 0) { console.log(`No scores recorded for ${slug}`); return; }
      console.table(scores.map(s => ({
        taskType: s.taskType,
        successRate: (s.successRate * 100).toFixed(1) + '%',
        effectiveScore: s.effectiveScore.toFixed(3),
        total: s.totalCount,
        avgLatency: s.avgLatencyMs.toFixed(0) + 'ms',
        decayFactor: s.decayFactor.toFixed(3),
      })));
    });

  cmd.command('top')
    .argument('<taskType>', 'Task type to rank agents by')
    .option('--n <count>', 'Number of top agents to show', parseInt, 10)
    .option('--json')
    .action(async (taskType, opts) => {
      const scorer = await getScorer();
      // Get all agents from registry (Task 30) and rank by task type
      const { RegistryQuery } = await import('../agents/registry-query.js');
      const q = new RegistryQuery();
      await q.load();
      const allSlugs = q.findByTaskType(taskType).map(a => a.slug);
      const ranked = await scorer.getTopCandidates(taskType, allSlugs, opts.n);
      if (opts.json) { console.log(JSON.stringify(ranked, null, 2)); return; }
      console.log(`Top ${opts.n} agents for task type '${taskType}':`);
      ranked.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.agentSlug} — ${(s.effectiveScore * 100).toFixed(1)}% effective (n=${s.totalCount})`);
      });
    });

  cmd.command('reset')
    .argument('<slug>', 'Agent slug')
    .option('--task-type <type>', 'Reset only a specific task type')
    .action(async (slug, opts) => {
      const scorer = await getScorer();
      const count = await scorer.resetScores(slug, opts.taskType);
      console.log(`Reset ${count} score record(s) for ${slug}`);
    });
}
```

## 6. Key Code Templates

**SQL schema:**

```sql
CREATE TABLE IF NOT EXISTS agent_specialization_scores (
  agent_slug       TEXT    NOT NULL,
  task_type        TEXT    NOT NULL,
  success_count    INTEGER NOT NULL DEFAULT 0,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  total_quality    REAL    NOT NULL DEFAULT 0,
  quality_count    INTEGER NOT NULL DEFAULT 0,
  last_updated     TEXT    NOT NULL,
  PRIMARY KEY (agent_slug, task_type)
);

CREATE INDEX IF NOT EXISTS idx_spec_scores_slug      ON agent_specialization_scores(agent_slug);
CREATE INDEX IF NOT EXISTS idx_spec_scores_task_type ON agent_specialization_scores(task_type);
CREATE INDEX IF NOT EXISTS idx_spec_scores_updated   ON agent_specialization_scores(last_updated);
```

**Score decay formula:**

```
effectiveScore(agent, taskType) = successRate × 0.5^(daysSinceLastUpdate / 90)

Where:
  successRate       = success_count / (success_count + failure_count)
  daysSinceLastUpdate = (now - last_updated) in days
  0.5^(n/90)        = halves every 90 days
```

**CLI commands:**

```bash
# View all task-type scores for an agent
npx claude-flow@v3alpha scores show engineering-security-engineer

# Rank all agents for a given task type
npx claude-flow@v3alpha scores top security-audit

# Reset scores (e.g., after major prompt rewrite)
npx claude-flow@v3alpha scores reset engineering-security-engineer
npx claude-flow@v3alpha scores reset engineering-security-engineer --task-type security-audit
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/agents/specialization-scorer.test.ts`):
- `recordOutcome({ success: true })` increments `success_count`
- `recordOutcome({ success: false })` increments `failure_count`
- `recordOutcome()` is idempotent for insert (uses `ON CONFLICT DO UPDATE`)
- `getScore()` returns correct `successRate`
- `getTopCandidates()` returns slugs sorted by `effectiveScore` descending
- `topCandidate()` returns the slug with the highest effective score
- `topCandidate()` returns the first candidate when no scores exist (graceful fallback)
- `resetScores(slug)` deletes all rows for that slug
- `resetScores(slug, taskType)` deletes only the specific task-type row

**Unit tests** (`v3/@claude-flow/cli/tests/agents/score-decay.test.ts`):
- `calculateDecayFactor` returns 1.0 for `lastUpdated = now`
- `calculateDecayFactor` returns ~0.5 for `lastUpdated = 90 days ago`
- `calculateDecayFactor` returns ~0.25 for `lastUpdated = 180 days ago`
- `calculateDecayFactor` never returns > 1.0 or < 0.0

**Integration tests** (`v3/mcp/tests/agent-spawn-scoring.test.ts`):
- When `handleSpawnAgent` receives `candidateAgents` and `taskType`, it selects the candidate with the highest score
- When no scores exist for any candidate, it falls back to the first candidate

## 8. Definition of Done

- [ ] `agent_specialization_scores` table exists in AgentDB after `init`
- [ ] Every `post-task` hook event with a known `taskType` updates `agent_specialization_scores`
- [ ] `SpecializationScorer.topCandidate()` selects the highest-scoring agent from candidates
- [ ] Time-decay correctly halves the effective score every 90 days
- [ ] `npx claude-flow@v3alpha scores show <slug>` prints per-task-type score table
- [ ] `npx claude-flow@v3alpha scores top <taskType>` ranks all known agents for that task type
- [ ] All unit tests pass
- [ ] TypeScript compiles without errors
