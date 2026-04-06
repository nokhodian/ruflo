# Task 35: Per-Agent Termination Conditions
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Low
**Depends on:** Task 29 (Agent Versioning — frontmatter schema extension pattern)
**Blocks:** (none)

## 1. Current State

Ruflo has no per-agent stopping criteria. Agent loops can run indefinitely without external termination. The only current stopping mechanisms are:

1. Manual `agent/terminate` MCP tool call (`v3/mcp/tools/agent-tools.ts` — `terminateAgentTool`)
2. Process-level SIGTERM/SIGKILL
3. Swarm-level timeout (if configured externally)

The `spawnAgentSchema` in `v3/mcp/tools/agent-tools.ts` (lines 152–158) does not include `maxTurns`, `maxCostUsd`, `timeoutMs`, or `stopOnPhrases`. The `ALLOWED_AGENT_TYPES` list (lines 33–138) maps types to agent slugs but carries no policy metadata.

No agent frontmatter file in `.claude/agents/**/*.md` contains a `capability.termination` block. The 12 background workers in `v3/@claude-flow/hooks/src/workers/` do not check termination policies at each tick.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` (lines 152–158), `handleSpawnAgent`
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/**/*.md` — all agent frontmatter files
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/` — background workers
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB

## 2. Gap Analysis

**What's missing:**
1. No `capability.termination` block in agent frontmatter — no per-agent policy declaration
2. `spawnAgentSchema` does not accept termination overrides at dispatch time
3. No `TerminationWatcher` that monitors running agents for policy violations
4. No `HALT` signal propagation via Raft consensus when a limit is reached
5. No AgentDB table for termination event records — impossible to audit runaway loops post-hoc
6. No `stop_on_phrases` scan in agent output — delegates who produce infinite "thinking" loops are not caught

**Concrete failure modes:**
- A `hierarchical-coordinator` agent spawns a delegation chain; each sub-agent re-delegates; the swarm grows unbounded at $0.015/call
- A `researcher` agent enters an infinite loop writing "Let me investigate further..." with no task completion signal
- A swarm with a $5 budget limit has no mechanism to self-terminate when $4.99 is spent; the next call may charge $2 for a single response

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/cli/src/agents/termination-watcher.ts` | Per-agent policy checker; called on each tick; emits HALT signal |
| `v3/@claude-flow/shared/src/types/termination.ts` | `TerminationPolicy`, `TerminationEvent`, `TerminationReason` interfaces |
| `v3/@claude-flow/cli/src/agents/halt-signal.ts` | Raft-based HALT signal broadcaster; marks agent as terminated in AgentDB |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `.claude/agents/**/*.md` | Add `capability.termination` block to all agent files (migration script) |
| `v3/mcp/tools/agent-tools.ts` | Extend `spawnAgentSchema` with optional `terminationPolicy` override field |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `agent_termination_events` table |
| `v3/@claude-flow/hooks/src/workers/mcp-tools.ts` (or worker index) | Register `TerminationWatcher` to run on each `post-task` tick |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Add `agent termination-policy` subcommand for viewing/overriding per-agent policies |

## 5. Implementation Steps

**Step 1: Define shared types**

Create `v3/@claude-flow/shared/src/types/termination.ts`:

```typescript
export interface TerminationPolicy {
  maxTurns?: number;          // default: 50 — max agent conversation turns
  maxCostUsd?: number;        // default: 1.00 — cumulative cost cap
  timeoutMs?: number;         // default: 300000 (5min) — wall-clock timeout
  stopOnPhrases?: string[];   // exact substrings; match triggers immediate halt
  maxRetries?: number;        // default: 3 — max consecutive tool call failures
}

export type TerminationReason =
  | 'max_turns_exceeded'
  | 'max_cost_exceeded'
  | 'timeout'
  | 'stop_phrase_matched'
  | 'max_retries_exceeded'
  | 'manual_halt'
  | 'task_complete';

export interface TerminationEvent {
  eventId: string;
  agentId: string;
  agentSlug: string;
  reason: TerminationReason;
  triggeredValue: string;     // e.g. "turn 51", "$1.03", "TASK_COMPLETE"
  swarmId?: string;
  terminatedAt: string;       // ISO 8601
  cascadeHalt: boolean;       // true if HALT was broadcast to dependent agents
}

export const DEFAULT_TERMINATION_POLICY: Required<TerminationPolicy> = {
  maxTurns: 50,
  maxCostUsd: 1.00,
  timeoutMs: 300_000,
  stopOnPhrases: ['TASK_COMPLETE', 'CANNOT_PROCEED', 'ESCALATE_TO_HUMAN'],
  maxRetries: 3,
};
```

**Step 2: Add termination frontmatter to agent files**

Add `capability.termination` block to all agent `.md` files. Example for `engineering-security-engineer.md`:

```yaml
capability:
  termination:
    max_turns: 30
    max_cost_usd: 0.75
    timeout_ms: 180000
    stop_on_phrases:
      - "TASK_COMPLETE"
      - "CANNOT_PROCEED"
      - "ESCALATE_TO_HUMAN"
```

For resource-intensive agents like `hierarchical-coordinator`:

```yaml
capability:
  termination:
    max_turns: 100
    max_cost_usd: 5.00
    timeout_ms: 600000
    stop_on_phrases:
      - "SWARM_COMPLETE"
      - "DELEGATION_FAILED"
```

For lightweight agents like `tester`:

```yaml
capability:
  termination:
    max_turns: 20
    max_cost_usd: 0.50
    timeout_ms: 120000
    stop_on_phrases:
      - "TASK_COMPLETE"
      - "ALL_TESTS_PASS"
      - "TESTS_FAILED_UNRECOVERABLE"
```

Migration script `scripts/migrate-termination-policies.ts`:

```typescript
import matter from 'gray-matter';
import { readFile, writeFile } from 'fs/promises';

const DEFAULTS: Record<string, object> = {
  'hierarchical-coordinator': { max_turns: 100, max_cost_usd: 5.00, timeout_ms: 600000 },
  'coder':                    { max_turns: 40,  max_cost_usd: 1.00, timeout_ms: 300000 },
  'tester':                   { max_turns: 20,  max_cost_usd: 0.50, timeout_ms: 120000 },
  'researcher':               { max_turns: 25,  max_cost_usd: 0.75, timeout_ms: 180000 },
  // default for all others:
  '__default__':              { max_turns: 30,  max_cost_usd: 1.00, timeout_ms: 300000 },
};

const STOP_PHRASES = ['TASK_COMPLETE', 'CANNOT_PROCEED', 'ESCALATE_TO_HUMAN'];

async function migrate(filePath: string): Promise<void> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  if (parsed.data.capability?.termination) return; // already migrated

  const slug = parsed.data.slug ?? require('path').basename(filePath, '.md');
  const policyDefaults = DEFAULTS[slug] ?? DEFAULTS['__default__'];

  parsed.data.capability = {
    ...(parsed.data.capability ?? {}),
    termination: { ...policyDefaults, stop_on_phrases: STOP_PHRASES },
  };
  await writeFile(filePath, matter.stringify(parsed.content, parsed.data));
}
```

**Step 3: Extend spawnAgentSchema**

In `v3/mcp/tools/agent-tools.ts`, extend `spawnAgentSchema` (after line 158):

```typescript
const terminationPolicySchema = z.object({
  maxTurns:       z.number().int().positive().optional(),
  maxCostUsd:     z.number().positive().optional(),
  timeoutMs:      z.number().int().positive().optional(),
  stopOnPhrases:  z.array(z.string()).optional(),
  maxRetries:     z.number().int().nonnegative().optional(),
}).optional();

const spawnAgentSchema = z.object({
  agentType: agentTypeSchema.describe('Type of agent to spawn'),
  id: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  metadata: z.record(z.unknown()).optional(),
  // New field (Task 35):
  terminationPolicy: terminationPolicySchema.describe(
    'Override default termination policy for this spawn. Merges with agent frontmatter defaults.'
  ),
});
```

**Step 4: Implement TerminationWatcher**

Create `v3/@claude-flow/cli/src/agents/termination-watcher.ts`:

```typescript
import { randomUUID } from 'crypto';
import { DEFAULT_TERMINATION_POLICY } from '@claude-flow/shared/src/types/termination.js';
import type { TerminationPolicy, TerminationEvent, TerminationReason } from '@claude-flow/shared/src/types/termination.js';

export interface AgentRunState {
  agentId: string;
  agentSlug: string;
  swarmId?: string;
  turnCount: number;
  cumulativeCostUsd: number;
  startedAt: Date;
  consecutiveFailures: number;
}

export class TerminationWatcher {
  constructor(
    private db: AgentDBBackend,
    private haltSignal: HaltSignal,
  ) {}

  async check(state: AgentRunState, lastOutput: string, policy: TerminationPolicy): Promise<TerminationEvent | null> {
    const effectivePolicy = { ...DEFAULT_TERMINATION_POLICY, ...policy };
    const now = new Date();

    // Check max_turns
    if (state.turnCount >= effectivePolicy.maxTurns) {
      return this.terminate(state, 'max_turns_exceeded', `turn ${state.turnCount}`);
    }
    // Check max_cost_usd
    if (state.cumulativeCostUsd >= effectivePolicy.maxCostUsd) {
      return this.terminate(state, 'max_cost_exceeded', `$${state.cumulativeCostUsd.toFixed(4)}`);
    }
    // Check timeout
    const elapsedMs = now.getTime() - state.startedAt.getTime();
    if (elapsedMs >= effectivePolicy.timeoutMs) {
      return this.terminate(state, 'timeout', `${elapsedMs}ms elapsed`);
    }
    // Check stop_on_phrases
    for (const phrase of effectivePolicy.stopOnPhrases) {
      if (lastOutput.includes(phrase)) {
        return this.terminate(state, 'stop_phrase_matched', phrase, false);
        // Note: stop_phrase = graceful task complete, cascadeHalt=false
      }
    }
    // Check max_retries
    if (state.consecutiveFailures >= effectivePolicy.maxRetries) {
      return this.terminate(state, 'max_retries_exceeded', `${state.consecutiveFailures} consecutive failures`);
    }
    return null; // no termination triggered
  }

  private async terminate(
    state: AgentRunState,
    reason: TerminationReason,
    triggeredValue: string,
    cascadeHalt = true,
  ): Promise<TerminationEvent> {
    const event: TerminationEvent = {
      eventId: randomUUID(),
      agentId: state.agentId,
      agentSlug: state.agentSlug,
      reason,
      triggeredValue,
      swarmId: state.swarmId,
      terminatedAt: new Date().toISOString(),
      cascadeHalt,
    };

    // Persist to AgentDB
    await this.db.run(
      `INSERT INTO agent_termination_events
       (event_id, agent_id, agent_slug, reason, triggered_value, swarm_id, terminated_at, cascade_halt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.eventId, event.agentId, event.agentSlug, event.reason, event.triggeredValue,
       event.swarmId ?? null, event.terminatedAt, event.cascadeHalt ? 1 : 0]
    );

    // Broadcast HALT if needed
    if (cascadeHalt && state.swarmId) {
      await this.haltSignal.broadcast(state.swarmId, state.agentId, reason);
    }

    return event;
  }
}
```

**Step 5: Add AgentDB table**

In `v3/@claude-flow/memory/src/agentdb-backend.ts`, add migration:

```typescript
await db.exec(`
  CREATE TABLE IF NOT EXISTS agent_termination_events (
    event_id        TEXT    PRIMARY KEY,
    agent_id        TEXT    NOT NULL,
    agent_slug      TEXT    NOT NULL,
    reason          TEXT    NOT NULL,
    triggered_value TEXT    NOT NULL,
    swarm_id        TEXT,
    terminated_at   TEXT    NOT NULL,
    cascade_halt    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_term_events_agent ON agent_termination_events(agent_id);
  CREATE INDEX IF NOT EXISTS idx_term_events_swarm ON agent_termination_events(swarm_id);
`);
```

## 6. Key Code Templates

**Full frontmatter `capability.termination` schema addition:**

```yaml
capability:
  termination:
    max_turns: 30                    # integer, default 50
    max_cost_usd: 0.75               # float, default 1.00
    timeout_ms: 180000               # integer ms, default 300000
    stop_on_phrases:                 # array of exact substrings
      - "TASK_COMPLETE"
      - "CANNOT_PROCEED"
      - "ESCALATE_TO_HUMAN"
```

**Recommended policies by agent category:**

| Category | max_turns | max_cost_usd | timeout_ms |
|---|---|---|---|
| Coordinators (hierarchical, mesh) | 100 | 5.00 | 600000 |
| Coders, architects | 40 | 1.50 | 300000 |
| Reviewers, testers | 20 | 0.50 | 120000 |
| Researchers | 25 | 0.75 | 180000 |
| Specialized (one-shot) | 10 | 0.25 | 60000 |

**CLI for termination policy inspection:**

```bash
# View effective termination policy for an agent
npx claude-flow@v3alpha agent termination-policy --slug engineering-security-engineer

# View recent termination events (runaway loop audit)
npx claude-flow@v3alpha agent termination-events --last 24h

# Override termination policy at spawn time
npx claude-flow@v3alpha agent spawn -t coder --termination-max-turns 10 --termination-max-cost 0.20
```

**TerminationEvent example:**

```json
{
  "eventId": "a1b2c3d4-...",
  "agentId": "agent-1kxyz-abc123",
  "agentSlug": "researcher",
  "reason": "max_turns_exceeded",
  "triggeredValue": "turn 51",
  "swarmId": "swarm-xyz",
  "terminatedAt": "2026-04-06T12:00:00Z",
  "cascadeHalt": true
}
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/agents/termination-watcher.test.ts`):
- `check()` returns `TerminationEvent` with `reason: 'max_turns_exceeded'` when `turnCount >= maxTurns`
- `check()` returns `TerminationEvent` with `reason: 'max_cost_exceeded'` when cost >= limit
- `check()` returns `TerminationEvent` with `reason: 'timeout'` when elapsed >= timeoutMs
- `check()` returns `TerminationEvent` with `reason: 'stop_phrase_matched'` when output contains phrase
- `check()` returns `null` when all conditions are within bounds
- `cascadeHalt: false` for `stop_phrase_matched` events (graceful completion)
- `cascadeHalt: true` for `max_turns_exceeded` and `max_cost_exceeded` events

**Unit tests** (`scripts/migrate-termination-policies.test.ts`):
- Migration adds `capability.termination` to files that lack it
- Migration is idempotent (re-running does not duplicate the block)
- Known coordinator slug gets `max_turns: 100` override

**Integration tests** (`v3/mcp/tests/agent-tools-termination.test.ts`):
- `agent/spawn` with `terminationPolicy: { maxTurns: 5 }` stores the override
- Spawning an agent with a default frontmatter policy loads `max_turns` from frontmatter

## 8. Definition of Done

- [ ] `capability.termination` block exists in all 230+ agent `.md` files
- [ ] `spawnAgentSchema` accepts optional `terminationPolicy` override
- [ ] `agent_termination_events` table exists in AgentDB
- [ ] `TerminationWatcher.check()` correctly fires for all 5 termination reasons
- [ ] HALT signal broadcasts to dependent swarm agents on `cascadeHalt: true` events
- [ ] `npx claude-flow@v3alpha agent termination-policy --slug <slug>` shows effective policy
- [ ] All unit tests pass
- [ ] Migration script is idempotent and covers all 230+ agent files
- [ ] TypeScript compiles without errors
