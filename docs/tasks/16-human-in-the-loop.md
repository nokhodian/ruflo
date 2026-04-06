# Task 16: Human-in-the-Loop Approval Gates
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Medium  
**Depends on:** None (can be implemented independently; integrates with Task 12 for checkpoint IDs)  
**Blocks:** None

---

## 1. Current State

Agents spawn and run to completion with no built-in human review point. High-risk agents (e.g., `engineering-devops-automator`, `engineering-solidity-smart-contract-engineer`) execute without confirmation. There are no `interrupt_before` semantics, no checkpoint save before high-risk actions, and no interactive CLI pause.

**Relevant files:**
- `v3/mcp/tools/agent-tools.ts` — `handleSpawnAgent()` — this is where spawning must be intercepted
- `v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` — `z.object({ agentType, id, config, priority, metadata })`
- `v3/@claude-flow/memory/src/agentdb-backend.ts` — used for checkpoint persistence
- `v3/@claude-flow/hooks/src/types.ts` — `HookEvent.AgentSpawn` can be leveraged
- `v3/@claude-flow/hooks/src/registry/index.ts` — `registerHook`

**Interrupt configuration today:** none — no field in `claude-flow.config.json`, no runtime mechanism.

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No `interrupt_before` config field | High-risk agents run without confirmation |
| No checkpoint before risky spawn | Cannot resume if operator rejects the action |
| No CLI interactive prompt | Cannot pause a running swarm for human input |
| No `confidence_threshold` interrupt | Low-confidence routing decisions auto-proceed |
| No resume-from-checkpoint path | Even if interrupted, there is no way back in |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/cli/src/interactive/interrupt.ts` | `InterruptController`: handles the CLI pause/prompt loop; reads a line from stdin; returns `approved | rejected | edited` |
| `v3/@claude-flow/hooks/src/checkpointer.ts` | `SwarmCheckpointer`: saves and loads swarm state to SQLite; returns a `checkpointId` |
| `v3/mcp/tools/interrupt-tools.ts` | MCP tool `interrupt/approve` and `interrupt/reject` for programmatic approval (CI mode) |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/mcp/tools/agent-tools.ts` | In `handleSpawnAgent()`, check `InterruptRegistry.shouldInterrupt(agentType)` before spawning; if yes, save checkpoint and call `InterruptController.prompt()` | Gate execution |
| `v3/@claude-flow/hooks/src/types.ts` | Add `HookEvent.InterruptRequested` and `HookEvent.InterruptResolved` | Observability |
| `v3/@claude-flow/hooks/src/index.ts` | Export `SwarmCheckpointer` | External access |

---

## 5. Implementation Steps

**Step 1 — Create `v3/@claude-flow/hooks/src/checkpointer.ts`**

```typescript
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

export interface AgentSpawnPayload {
  agentType: string;
  agentId: string;
  config?: Record<string, unknown>;
  priority: string;
  metadata?: Record<string, unknown>;
}

export interface SwarmCheckpointRecord {
  checkpointId: string;
  swarmId: string;
  step: number;
  pendingSpawn: AgentSpawnPayload;
  createdAt: number;
  resumedAt?: number;
  status: 'pending' | 'approved' | 'rejected';
}

export class SwarmCheckpointer {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS swarm_checkpoints (
        checkpoint_id  TEXT PRIMARY KEY,
        swarm_id       TEXT NOT NULL,
        step           INTEGER NOT NULL,
        pending_spawn  TEXT NOT NULL,  -- JSON
        created_at     INTEGER NOT NULL,
        resumed_at     INTEGER,
        status         TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_chk_swarm ON swarm_checkpoints(swarm_id);
      CREATE INDEX IF NOT EXISTS idx_chk_status ON swarm_checkpoints(status);
    `);
  }

  save(swarmId: string, step: number, pendingSpawn: AgentSpawnPayload): string {
    const checkpointId = `chk-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    this.db.prepare(`
      INSERT INTO swarm_checkpoints (checkpoint_id, swarm_id, step, pending_spawn, created_at, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(checkpointId, swarmId, step, JSON.stringify(pendingSpawn), Date.now());
    return checkpointId;
  }

  approve(checkpointId: string): void {
    this.db.prepare(
      'UPDATE swarm_checkpoints SET status = ?, resumed_at = ? WHERE checkpoint_id = ?'
    ).run('approved', Date.now(), checkpointId);
  }

  reject(checkpointId: string): void {
    this.db.prepare(
      'UPDATE swarm_checkpoints SET status = ?, resumed_at = ? WHERE checkpoint_id = ?'
    ).run('rejected', Date.now(), checkpointId);
  }

  get(checkpointId: string): SwarmCheckpointRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM swarm_checkpoints WHERE checkpoint_id = ?'
    ).get(checkpointId) as any;
    if (!row) return undefined;
    return {
      checkpointId: row.checkpoint_id,
      swarmId: row.swarm_id,
      step: row.step,
      pendingSpawn: JSON.parse(row.pending_spawn),
      createdAt: row.created_at,
      resumedAt: row.resumed_at ?? undefined,
      status: row.status,
    };
  }

  listPending(): SwarmCheckpointRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM swarm_checkpoints WHERE status = 'pending' ORDER BY created_at ASC"
    ).all() as any[];
    return rows.map(row => ({
      checkpointId: row.checkpoint_id,
      swarmId: row.swarm_id,
      step: row.step,
      pendingSpawn: JSON.parse(row.pending_spawn),
      createdAt: row.created_at,
      resumedAt: undefined,
      status: 'pending' as const,
    }));
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 2 — Create `v3/@claude-flow/cli/src/interactive/interrupt.ts`**

```typescript
import * as readline from 'node:readline';

export type InterruptDecision = 'approved' | 'rejected' | 'edited';

export interface InterruptPromptResult {
  decision: InterruptDecision;
  editedTask?: string;  // populated only when decision === 'edited'
}

export interface InterruptConfig {
  /** Agent slugs that require human approval before spawning */
  interruptBefore: string[];
  /** Interrupt when routing confidence < this value */
  confidenceThreshold?: number;
  /** In CI mode, auto-approve all interrupts */
  autoApprove?: boolean;
}

/** Singleton registry; loaded from claude-flow.config.json at startup */
export class InterruptRegistry {
  private config: InterruptConfig = { interruptBefore: [] };

  load(config: InterruptConfig): void {
    this.config = config;
  }

  shouldInterrupt(agentSlug: string, confidence?: number): boolean {
    if (this.config.autoApprove) return false;
    if (this.config.interruptBefore.includes(agentSlug)) return true;
    if (
      confidence !== undefined &&
      this.config.confidenceThreshold !== undefined &&
      confidence < this.config.confidenceThreshold
    ) return true;
    return false;
  }
}

export const interruptRegistry = new InterruptRegistry();

export class InterruptController {
  /**
   * Pause execution and prompt the user.
   * In non-interactive mode (no TTY), auto-rejects unless CI_AUTO_APPROVE=1.
   */
  async prompt(
    agentSlug: string,
    taskDescription: string,
    checkpointId: string
  ): Promise<InterruptPromptResult> {
    // CI / non-TTY mode
    if (!process.stdin.isTTY || process.env.CI_AUTO_APPROVE === '1') {
      console.log(`[RUFLO] Auto-approving (CI mode): ${agentSlug}`);
      return { decision: 'approved' };
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\n' + '═'.repeat(60));
    console.log('[RUFLO] Interrupt — Human approval required');
    console.log(`  Agent:      ${agentSlug}`);
    console.log(`  Task:       ${taskDescription}`);
    console.log(`  Checkpoint: ${checkpointId}`);
    console.log('═'.repeat(60));
    console.log('  Options: [y] approve  [n] reject  [e] edit task');

    return new Promise<InterruptPromptResult>((resolve) => {
      rl.question('  Choice (y/n/e): ', (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'y' || trimmed === 'yes') {
          console.log('[RUFLO] Approved. Resuming...\n');
          resolve({ decision: 'approved' });
        } else if (trimmed === 'e' || trimmed === 'edit') {
          const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl2.question('  New task description: ', (newTask) => {
            rl2.close();
            console.log('[RUFLO] Task edited. Resuming...\n');
            resolve({ decision: 'edited', editedTask: newTask });
          });
        } else {
          console.log('[RUFLO] Rejected. Spawn cancelled.\n');
          resolve({ decision: 'rejected' });
        }
      });
    });
  }
}

export const interruptController = new InterruptController();
```

**Step 3 — Modify `v3/mcp/tools/agent-tools.ts` — intercept `handleSpawnAgent`**

Read the file first, then edit `handleSpawnAgent`. After the `agentId` / `createdAt` setup block, add:

```typescript
// ── Human-in-the-Loop gate ───────────────────────────────────────────────────
import { interruptRegistry, interruptController } from '../../@claude-flow/cli/src/interactive/interrupt.js';
import { SwarmCheckpointer } from '../../@claude-flow/hooks/src/checkpointer.js';

// In handleSpawnAgent(), before the swarmCoordinator block:
const checkpointerPath = process.env.CHECKPOINT_DB_PATH ?? './data/checkpoints.db';
const checkpointer = new SwarmCheckpointer(checkpointerPath);

if (interruptRegistry.shouldInterrupt(input.agentType)) {
  const taskDescription = (input.config?.task as string) ?? `Spawn ${input.agentType}`;
  const swarmId = (input.metadata?.swarmId as string) ?? 'default-swarm';
  const step    = (input.metadata?.step as number) ?? 0;

  const checkpointId = checkpointer.save(swarmId, step, {
    agentType: input.agentType,
    agentId,
    config: input.config,
    priority: input.priority,
    metadata: input.metadata,
  });

  const result = await interruptController.prompt(
    input.agentType,
    taskDescription,
    checkpointId
  );

  if (result.decision === 'rejected') {
    checkpointer.reject(checkpointId);
    checkpointer.close();
    return {
      agentId,
      agentType: input.agentType,
      status: 'rejected',
      createdAt,
    } as SpawnAgentResult;
  }

  if (result.decision === 'edited' && result.editedTask) {
    input = { ...input, config: { ...input.config, task: result.editedTask } };
  }

  checkpointer.approve(checkpointId);
  checkpointer.close();
}
// ── End HitL gate ────────────────────────────────────────────────────────────
```

**Step 4 — Create `v3/mcp/tools/interrupt-tools.ts`**

```typescript
import { z } from 'zod';
import { MCPTool } from '../types.js';
import { SwarmCheckpointer } from '../@claude-flow/hooks/src/checkpointer.js';

let _checkpointer: SwarmCheckpointer | null = null;
export function setCheckpointer(c: SwarmCheckpointer): void { _checkpointer = c; }

function getCheckpointer(): SwarmCheckpointer {
  if (!_checkpointer) throw new Error('SwarmCheckpointer not initialized');
  return _checkpointer;
}

export const interruptApproveTool: MCPTool = {
  name: 'interrupt/approve',
  description: 'Approve a pending human-in-the-loop checkpoint (for CI/programmatic use)',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: { type: 'string', description: 'Checkpoint ID returned by interrupt' },
    },
    required: ['checkpointId'],
  },
  handler: async (input) => {
    const { checkpointId } = z.object({ checkpointId: z.string() }).parse(input);
    getCheckpointer().approve(checkpointId);
    return { approved: true, checkpointId };
  },
  category: 'safety',
  tags: ['human-in-the-loop', 'approval', 'checkpoint'],
  version: '1.0.0',
};

export const interruptRejectTool: MCPTool = {
  name: 'interrupt/reject',
  description: 'Reject a pending human-in-the-loop checkpoint',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: { type: 'string' },
      reason: { type: 'string', description: 'Reason for rejection (optional)' },
    },
    required: ['checkpointId'],
  },
  handler: async (input) => {
    const { checkpointId } = z.object({ checkpointId: z.string(), reason: z.string().optional() }).parse(input);
    getCheckpointer().reject(checkpointId);
    return { rejected: true, checkpointId };
  },
  category: 'safety',
  tags: ['human-in-the-loop', 'rejection', 'checkpoint'],
  version: '1.0.0',
};

export const interruptListTool: MCPTool = {
  name: 'interrupt/list',
  description: 'List pending checkpoints awaiting human approval',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const pending = getCheckpointer().listPending();
    return { pending, count: pending.length };
  },
  category: 'safety',
  tags: ['human-in-the-loop', 'list'],
  version: '1.0.0',
};

export const interruptTools: MCPTool[] = [
  interruptApproveTool,
  interruptRejectTool,
  interruptListTool,
];
export default interruptTools;
```

**Step 5 — Add `InterruptConfig` loading in CLI init**

In `v3/@claude-flow/cli/src/commands/index.ts` or the main CLI entry:
```typescript
import { interruptRegistry } from '../interactive/interrupt.js';

// Load from claude-flow.config.json
const config = loadConfig(); // existing config loader
if (config.interrupt) {
  interruptRegistry.load({
    interruptBefore: config.interrupt.interrupt_before ?? [],
    confidenceThreshold: config.interrupt.confidence_threshold,
    autoApprove: process.env.CI === 'true',
  });
}
```

**Step 6 — Export from hooks package**

In `v3/@claude-flow/hooks/src/index.ts`:
```typescript
export { SwarmCheckpointer, type SwarmCheckpointRecord, type AgentSpawnPayload } from './checkpointer.js';
```

---

## 6. Key Code Templates

### `claude-flow.config.json` example
```json
{
  "interrupt": {
    "interrupt_before": [
      "engineering-devops-automator",
      "engineering-solidity-smart-contract-engineer"
    ],
    "interrupt_on_low_confidence": true,
    "confidence_threshold": 0.65
  }
}
```

### CLI interaction example
```
═══════════════════════════════════════════════════
[RUFLO] Interrupt — Human approval required
  Agent:      engineering-devops-automator
  Task:       Deploy updated auth service to staging
  Checkpoint: chk-1b2c3d4e-xxxx
═══════════════════════════════════════════════════
  Options: [y] approve  [n] reject  [e] edit task
  Choice (y/n/e): y
[RUFLO] Approved. Resuming...
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/hooks/src/checkpointer.test.ts`**
```typescript
describe('SwarmCheckpointer', () => {
  it('saves a checkpoint and retrieves it by id', () => { ... });
  it('approve() sets status to approved', () => { ... });
  it('reject() sets status to rejected', () => { ... });
  it('listPending() returns only pending checkpoints', () => { ... });
});
```

**Unit — `v3/@claude-flow/cli/src/interactive/interrupt.test.ts`**
```typescript
describe('InterruptRegistry', () => {
  it('shouldInterrupt returns true for listed agent slug', () => {
    const reg = new InterruptRegistry();
    reg.load({ interruptBefore: ['engineering-devops-automator'] });
    expect(reg.shouldInterrupt('engineering-devops-automator')).toBe(true);
    expect(reg.shouldInterrupt('coder')).toBe(false);
  });
  it('shouldInterrupt returns false when autoApprove is true', () => { ... });
  it('shouldInterrupt returns true when confidence < threshold', () => { ... });
});
```

**Integration — `handleSpawnAgent` gate test**
```typescript
describe('handleSpawnAgent with HitL', () => {
  it('saves checkpoint and returns status=rejected when user rejects', async () => {
    // Mock interruptController.prompt to return { decision: 'rejected' }
    // interruptRegistry.load({ interruptBefore: ['test-agent'] })
    // call handleSpawnAgent({ agentType: 'test-agent', ... })
    // expect result.status === 'rejected'
    // expect checkpointer.get(checkpointId).status === 'rejected'
  });
  it('proceeds normally when agent not in interrupt list', async () => { ... });
});
```

---

## 8. Definition of Done

- [ ] `SwarmCheckpointer` compiles; SQLite schema created; save/approve/reject/list all work
- [ ] `InterruptRegistry.shouldInterrupt()` correctly reads `interruptBefore` and `confidenceThreshold`
- [ ] `InterruptController.prompt()` renders the 3-option menu on TTY
- [ ] In non-TTY mode, `prompt()` auto-approves (no hang)
- [ ] `handleSpawnAgent` in `agent-tools.ts` calls gate before coordinator
- [ ] `status: 'rejected'` returned when user rejects; agent is NOT spawned
- [ ] `interrupt/approve`, `interrupt/reject`, `interrupt/list` MCP tools registered
- [ ] Config key `interrupt.interrupt_before` loaded from `claude-flow.config.json`
- [ ] Unit tests pass for `SwarmCheckpointer` and `InterruptRegistry`
- [ ] Integration test confirms rejected spawn does not call `coordinator.spawnAgent()`
