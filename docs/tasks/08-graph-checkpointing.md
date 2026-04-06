# Task 08: Full Graph Checkpointing + Resume

**Priority:** Phase 1 — Foundation
**Effort:** Medium
**Depends on:** 07 (cost tracking DB provides the SQLite backend to write checkpoints into)
**Blocks:** 16 (human-in-the-loop resumes from checkpoints), 14 (session replay reads checkpoint history)

---

## 1. Current State

Ruflo has no full-graph checkpoint mechanism. Individual agents may store partial state via the `post-task` hook, but there is no coordinated snapshot of the complete swarm execution graph.

**Existing infrastructure to leverage:**

| Path | Purpose |
|---|---|
| `v3/@claude-flow/memory/src/sqlite-backend.ts` | SQLite persistence layer (checkpoint tables go here) |
| `v3/@claude-flow/memory/src/sqljs-backend.ts` | WASM SQLite — same API, no native deps |
| `v3/@claude-flow/memory/src/agent-db.ts` | AgentDB adapter — top-level entry point |
| `v3/@claude-flow/hooks/src/hooks/post-task.ts` | Fires after every task — checkpoint trigger goes here |
| `v3/@claude-flow/hooks/src/hooks/session-end.ts` | Final checkpoint on session close |
| `v3/@claude-flow/cli/src/commands/` | 26 CLI commands — add `checkpoint.ts` here |
| `v3/mcp/tools/agent-tools.ts` | Agent spawn — checkpoint ID injected into swarm context |

**What is missing:**
- No `SwarmCheckpoint` data structure
- No serialisation of all-agent states + message queues in one atomic write
- No checkpoint-ID lifecycle (create → list → resume → diff)
- No CLI commands: `checkpoint list`, `checkpoint resume`, `checkpoint diff`
- No `on_checkpoint` hook event for external observability

---

## 2. Gap Analysis

**Failure modes without checkpointing:**

1. **Crash loss** — A 30-minute background swarm (12 workers) crashes at minute 28. All work is lost; must restart from scratch.
2. **No time-travel debugging** — When a swarm produces a wrong result, there is no way to rewind to where the incorrect decision was made.
3. **Human-in-the-loop (Task 16) is impossible** — Pausing for human approval requires persisting the exact graph state so it can be resumed after response.
4. **No audit trail** — Raft consensus decisions (Task 36) and session replays (Task 14) need a checkpoint log as source of truth.
5. **Background workers restart cold** — The 12 workers (`ultralearn`, `optimize`, `audit`, etc.) restart with no memory of prior state when the daemon bounces.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/memory/src/checkpointer.ts` | `SwarmCheckpointer` class — save/load/list/diff |
| `v3/@claude-flow/memory/src/types/checkpoint.ts` | `SwarmCheckpoint`, `AgentState`, `CheckpointMeta` interfaces |
| `v3/@claude-flow/cli/src/commands/checkpoint.ts` | CLI: `checkpoint list/resume/diff/inspect/purge` |
| `v3/@claude-flow/hooks/src/workers/checkpoint-worker.ts` | Background worker for periodic auto-checkpoints |
| `v3/@claude-flow/hooks/src/checkpointer-registry.ts` | Registry mapping swarmId+sessionId to SwarmCheckpointer |
| `v3/@claude-flow/memory/src/__tests__/checkpointer.test.ts` | Unit tests |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `v3/@claude-flow/memory/src/sqlite-backend.ts` | Add `swarm_checkpoints` table + CRUD methods |
| `v3/@claude-flow/memory/src/agent-db.ts` | Export `SwarmCheckpointer`; add `checkpointer()` factory |
| `v3/@claude-flow/hooks/src/hooks/post-task.ts` | Call `checkpointer.saveIncremental()` after each task |
| `v3/@claude-flow/hooks/src/hooks/session-end.ts` | Call `checkpointer.saveFull()` on session close |
| `v3/@claude-flow/cli/src/commands/index.ts` | Register `checkpoint` command |
| `v3/@claude-flow/hooks/src/workers/index.ts` | Register `CheckpointWorker` as worker #13 |
| `v3/mcp/tools/agent-tools.ts` | Accept `resumeFromCheckpoint` in spawn schema |

---

## 5. Implementation Steps

### Step 1 — Define types

Create `v3/@claude-flow/memory/src/types/checkpoint.ts`:

```typescript
export interface AgentState {
  agentId: string;
  agentSlug: string;
  status: 'active' | 'idle' | 'completed' | 'failed';
  messageHistory: unknown[];
  toolCallStack: unknown[];
  taskId?: string;
  metadata: Record<string, unknown>;
  snapshotAt: string;
}

export interface SwarmCheckpoint {
  checkpointId: string;
  swarmId: string;
  sessionId: string;
  step: number;
  trigger: 'post-task' | 'session-end' | 'manual' | 'interrupt' | 'periodic';
  agentStates: AgentState[];
  messageQueues: Record<string, unknown[]>;
  consensusState?: unknown;
  taskResults: Record<string, unknown>;
  stateHash: string;
  createdAt: string;
  parentCheckpointId?: string;
}

export interface CheckpointMeta {
  checkpointId: string;
  swarmId: string;
  sessionId: string;
  step: number;
  trigger: string;
  agentCount: number;
  stateHash: string;
  createdAt: string;
}
```

### Step 2 — Add SQLite schema

In `sqlite-backend.ts` `initialize()`:

```sql
CREATE TABLE IF NOT EXISTS swarm_checkpoints (
  checkpoint_id  TEXT PRIMARY KEY,
  swarm_id       TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  step           INTEGER NOT NULL,
  trigger        TEXT NOT NULL,
  agent_count    INTEGER NOT NULL,
  state_hash     TEXT NOT NULL,
  payload        TEXT NOT NULL,
  parent_id      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chk_swarm   ON swarm_checkpoints(swarm_id);
CREATE INDEX IF NOT EXISTS idx_chk_session ON swarm_checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_chk_step    ON swarm_checkpoints(swarm_id, step);
```

Add methods: `saveCheckpoint(cp)`, `loadCheckpoint(id)`, `listCheckpoints(swarmId, limit)`, `deleteCheckpointsBefore(swarmId, days)`.

### Step 3 — Implement `SwarmCheckpointer`

```typescript
// v3/@claude-flow/memory/src/checkpointer.ts
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

export class SwarmCheckpointer {
  private stepCounter = 0;

  constructor(
    private readonly db: SqliteBackend,
    private readonly swarmId: string,
    private readonly sessionId: string,
  ) {}

  async saveFull(
    agentStates: AgentState[],
    messageQueues: Record<string, unknown[]>,
    taskResults: Record<string, unknown>,
    trigger: SwarmCheckpoint['trigger'] = 'post-task',
    parentCheckpointId?: string,
  ): Promise<string> {
    const checkpointId = randomUUID();
    const step = ++this.stepCounter;
    const payload: SwarmCheckpoint = {
      checkpointId, swarmId: this.swarmId, sessionId: this.sessionId,
      step, trigger, agentStates, messageQueues, taskResults,
      stateHash: createHash('sha256').update(JSON.stringify({ agentStates, messageQueues, taskResults })).digest('hex').slice(0, 16),
      createdAt: new Date().toISOString(),
      parentCheckpointId,
    };
    await this.db.saveCheckpoint(payload);
    return checkpointId;
  }

  async saveIncremental(agentId: string, newState: Partial<AgentState>): Promise<void> {
    const latest = await this.db.listCheckpoints(this.swarmId, 1);
    if (!latest.length) return;
    const cp = await this.db.loadCheckpoint(latest[0].checkpointId);
    if (!cp) return;
    const idx = cp.agentStates.findIndex(a => a.agentId === agentId);
    if (idx >= 0) Object.assign(cp.agentStates[idx], newState);
    else cp.agentStates.push({ agentId, ...newState } as AgentState);
    cp.checkpointId = randomUUID();
    cp.step = ++this.stepCounter;
    cp.trigger = 'post-task';
    cp.parentCheckpointId = latest[0].checkpointId;
    cp.createdAt = new Date().toISOString();
    await this.db.saveCheckpoint(cp);
  }

  async load(id: string): Promise<SwarmCheckpoint | null> {
    return this.db.loadCheckpoint(id);
  }

  async list(limit = 20): Promise<CheckpointMeta[]> {
    return this.db.listCheckpoints(this.swarmId, limit);
  }

  async latest(): Promise<SwarmCheckpoint | null> {
    const metas = await this.list(1);
    return metas.length ? this.load(metas[0].checkpointId) : null;
  }

  async purge(olderThanDays = 7): Promise<void> {
    await this.db.deleteCheckpointsBefore(this.swarmId, olderThanDays);
  }
}
```

### Step 4 — Wire into hooks

`post-task.ts` — add at end:
```typescript
const cp = getCheckpointer(context.swarmId, context.sessionId);
if (cp) await cp.saveIncremental(context.agentId, { status: success ? 'completed' : 'failed', taskId: context.taskId, snapshotAt: new Date().toISOString() });
```

`session-end.ts` — add at end:
```typescript
const cp = getCheckpointer(context.swarmId, context.sessionId);
if (cp) await cp.saveFull(context.agentStates, context.messageQueues, context.taskResults, 'session-end');
```

### Step 5 — CLI commands

```bash
npx claude-flow@v3alpha checkpoint list   --swarm-id <id> [--limit 20]
npx claude-flow@v3alpha checkpoint inspect --checkpoint-id <id> --swarm-id <id>
npx claude-flow@v3alpha checkpoint resume  --checkpoint-id <id> --swarm-id <id>
npx claude-flow@v3alpha checkpoint diff    --from <id> --to <id> --swarm-id <id>
npx claude-flow@v3alpha checkpoint purge   --swarm-id <id> [--older-than 7]
```

Register in `commands/index.ts`:
```typescript
import { createCheckpointCommand } from './checkpoint.js';
program.addCommand(createCheckpointCommand());
```

### Step 6 — Periodic background worker

```typescript
// v3/@claude-flow/hooks/src/workers/checkpoint-worker.ts
export class CheckpointWorker extends BackgroundWorker {
  readonly name = 'checkpoint';
  readonly priority = 'low';
  readonly intervalMs = 60_000;

  async execute(context: WorkerContext): Promise<void> {
    const cp = getCheckpointer(context.swarmId, context.sessionId);
    if (!cp) return;
    await cp.saveFull(context.agentStates, context.messageQueues, context.taskResults, 'periodic');
  }
}
```

Register as worker #13 in `workers/index.ts`.

### Step 7 — MCP spawn schema extension

In `agent-tools.ts` `spawnAgentSchema`:
```typescript
resumeFromCheckpoint: z.string().optional().describe('Checkpoint ID to restore agent state from'),
```

In `handleSpawnAgent()`, after agent creation, if `resumeFromCheckpoint` is provided: load checkpoint, find matching `agentSlug` state, inject message history into agent context.

---

## 6. Key Code Templates

See Step 1–3 above. Additional CLI command skeleton:

```typescript
// v3/@claude-flow/cli/src/commands/checkpoint.ts
import { Command } from 'commander';

export function createCheckpointCommand(): Command {
  const cmd = new Command('checkpoint').description('Manage swarm execution checkpoints');
  // sub-commands: list, inspect, resume, diff, purge
  // each sub-command: import SwarmCheckpointer from @claude-flow/memory, call relevant method
  return cmd;
}
```

---

## 7. Testing Strategy

**Unit tests** (`checkpointer.test.ts`):
- `saveFull()` persists and `load()` retrieves identical data
- `saveIncremental()` patches agent status without creating full duplicate
- `latest()` returns highest `step` number
- `list()` returns ordered results newest-first
- `purge(0)` empties all checkpoints for the swarm
- Diff correctly reports `addedAgents`, `removedAgents`, `changedAgents`

**Integration tests**:
- Fire `post-task` hook → verify `swarm_checkpoints` table has a new row
- Fire `session-end` hook → verify `trigger = 'session-end'` row exists
- `CheckpointWorker.execute()` saves periodic snapshot every 60s interval

**CLI smoke tests**:
```bash
npx claude-flow@v3alpha checkpoint list --swarm-id fake-swarm | grep -q "No checkpoints"
# After real swarm run:
npx claude-flow@v3alpha checkpoint list --swarm-id $SWARM_ID | grep -q "post-task"
```

---

## 8. Definition of Done

- [ ] `swarm_checkpoints` table created with correct schema and indexes
- [ ] `SwarmCheckpointer.saveFull()` persists all agent states atomically
- [ ] `SwarmCheckpointer.saveIncremental()` updates one agent in latest checkpoint
- [ ] `post-task` hook triggers `saveIncremental()` on every task completion
- [ ] `session-end` hook triggers `saveFull()` with `trigger: 'session-end'`
- [ ] `CheckpointWorker` registered as worker #13, fires every 60s
- [ ] All 5 CLI subcommands work: `list`, `inspect`, `resume`, `diff`, `purge`
- [ ] `resumeFromCheckpoint` field accepted in MCP `agent/spawn` schema
- [ ] All unit tests pass: `npx jest checkpointer`
- [ ] TypeScript compiles clean: `npx tsc --noEmit`
- [ ] `checkpoint list` returns rows after any swarm task runs
- [ ] Task 16 (human-in-the-loop) can reference `checkpointId` for resume

## Status

PENDING
