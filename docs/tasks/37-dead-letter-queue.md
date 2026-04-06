# Task 37: Dead Letter Queue + Message Forensics
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Low
**Depends on:** Task 38 (Tool Retry — DLQ receives messages after retry exhaustion)
**Blocks:** (none)

## 1. Current State

Failed messages in ruflo are silently discarded. When an agent tool call fails (network timeout, Zod validation error, rate limit), the error is logged to the console but no record of the original message, the failure reason, or the delivery attempt history is persisted.

The `post-task` hook in `v3/@claude-flow/hooks/src/workers/mcp-tools.ts` emits a failure event but does not write the failed message payload to any durable store. Background workers that fail (`v3/@claude-flow/hooks/src/workers/`) log to stderr and exit silently.

AgentDB (`v3/@claude-flow/memory/src/agentdb-backend.ts`) has no `dead_letter_queue` or `delivery_attempts` tables.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/mcp-tools.ts` — post-task failure handling
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB schema
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/task-tools.ts` — task completion/failure handlers
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/agent.ts` — agent CLI (no `dlq` subcommand exists)

## 2. Gap Analysis

**What's missing:**
1. No `dead_letter_queue` table — failed messages are irrecoverable after process restart
2. No `delivery_attempts` table — no history of which retries were tried, with what errors
3. No `dlq` CLI command — operators cannot inspect, replay, or purge failed messages
4. No replay mechanism — a fixed service cannot automatically re-deliver previously failed messages
5. No auto-purge policy — stale DLQ entries accumulate indefinitely
6. Task 38 (Tool Retry) has no "last resort" destination after retry exhaustion

**Concrete failure modes:**
- Rate limit causes task failure at 2 AM; operator cannot diagnose it in the morning because no record exists
- A Zod validation error in `spawnAgentSchema` fails a critical task; the original `taskDescription` and `agentType` are lost
- An intermittent network blip fails 5 messages; after the blip resolves, there is no way to replay them
- DLQ entries from weeks ago consume memory with no TTL enforcement

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/cli/src/dlq/dlq-writer.ts` | Writes `DLQEntry` to AgentDB; called by retry layer after `maxAttempts` exhausted |
| `v3/@claude-flow/cli/src/dlq/dlq-reader.ts` | Queries DLQ; list, inspect, filter |
| `v3/@claude-flow/cli/src/dlq/dlq-replayer.ts` | Replays a DLQ entry by re-submitting original message to the appropriate tool |
| `v3/@claude-flow/cli/src/commands/dlq.ts` | CLI: `dlq list`, `dlq inspect`, `dlq replay`, `dlq purge` |
| `v3/@claude-flow/shared/src/types/dlq.ts` | `DLQEntry`, `DeliveryAttempt`, `DLQReplayResult` TypeScript interfaces |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `dead_letter_queue` and `delivery_attempts` table migrations |
| `v3/@claude-flow/hooks/src/workers/mcp-tools.ts` | On task failure after final retry, call `DLQWriter.enqueue()` |
| `v3/mcp/tools/task-tools.ts` | In failure handler, pass message to `DLQWriter.enqueue()` |
| `v3/@claude-flow/cli/src/commands/agent.ts` (or `index.ts`) | Register `dlq` as a top-level CLI command |

## 5. Implementation Steps

**Step 1: Define shared types**

Create `v3/@claude-flow/shared/src/types/dlq.ts`:

```typescript
export interface DeliveryAttempt {
  attemptNumber: number;    // 1-based
  attemptedAt: string;      // ISO 8601
  errorType: string;        // e.g. 'RATE_LIMIT' | 'TIMEOUT' | 'VALIDATION' | 'UNKNOWN'
  errorMessage: string;
  latencyMs: number;
}

export interface DLQEntry {
  messageId: string;         // uuid
  toolName: string;          // MCP tool that failed, e.g. 'agent/spawn'
  originalPayload: Record<string, unknown>;  // original tool input
  deliveryAttempts: DeliveryAttempt[];
  finalError: string;        // human-readable final failure reason
  finalErrorType: string;
  agentId?: string;          // agent that sent the message, if known
  swarmId?: string;
  createdAt: string;         // ISO 8601 — when first failure occurred
  archivedAt: string;        // ISO 8601 — when moved to DLQ
  replayedAt?: string;       // ISO 8601 — when replayed, if ever
  replayResult?: 'success' | 'failed_again';
  status: 'pending' | 'replayed' | 'purged';
  tags: string[];
}

export interface DLQReplayResult {
  messageId: string;
  success: boolean;
  errorMessage?: string;
  replayedAt: string;
}
```

**Step 2: SQLite schema**

In `v3/@claude-flow/memory/src/agentdb-backend.ts`, add:

```typescript
await db.exec(`
  CREATE TABLE IF NOT EXISTS dead_letter_queue (
    message_id        TEXT    PRIMARY KEY,
    tool_name         TEXT    NOT NULL,
    original_payload  TEXT    NOT NULL,   -- JSON
    final_error       TEXT    NOT NULL,
    final_error_type  TEXT    NOT NULL,
    agent_id          TEXT,
    swarm_id          TEXT,
    created_at        TEXT    NOT NULL,
    archived_at       TEXT    NOT NULL,
    replayed_at       TEXT,
    replay_result     TEXT,               -- 'success' | 'failed_again' | NULL
    status            TEXT    NOT NULL DEFAULT 'pending',
    tags              TEXT    NOT NULL DEFAULT '[]'  -- JSON array
  );

  CREATE TABLE IF NOT EXISTS dlq_delivery_attempts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id     TEXT    NOT NULL REFERENCES dead_letter_queue(message_id),
    attempt_number INTEGER NOT NULL,
    attempted_at   TEXT    NOT NULL,
    error_type     TEXT    NOT NULL,
    error_message  TEXT    NOT NULL,
    latency_ms     INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_dlq_status     ON dead_letter_queue(status);
  CREATE INDEX IF NOT EXISTS idx_dlq_tool       ON dead_letter_queue(tool_name);
  CREATE INDEX IF NOT EXISTS idx_dlq_agent      ON dead_letter_queue(agent_id);
  CREATE INDEX IF NOT EXISTS idx_dlq_swarm      ON dead_letter_queue(swarm_id);
  CREATE INDEX IF NOT EXISTS idx_dlq_archived   ON dead_letter_queue(archived_at);
  CREATE INDEX IF NOT EXISTS idx_dlq_attempts   ON dlq_delivery_attempts(message_id);
`);
```

**Step 3: Implement DLQWriter**

Create `v3/@claude-flow/cli/src/dlq/dlq-writer.ts`:

```typescript
import { randomUUID } from 'crypto';
import type { DLQEntry, DeliveryAttempt } from '@claude-flow/shared/src/types/dlq.js';

export interface EnqueueInput {
  toolName: string;
  originalPayload: Record<string, unknown>;
  deliveryAttempts: DeliveryAttempt[];
  agentId?: string;
  swarmId?: string;
  tags?: string[];
}

export class DLQWriter {
  constructor(private db: AgentDBBackend) {}

  async enqueue(input: EnqueueInput): Promise<DLQEntry> {
    const messageId = randomUUID();
    const now = new Date().toISOString();
    const lastAttempt = input.deliveryAttempts[input.deliveryAttempts.length - 1];

    const entry: DLQEntry = {
      messageId,
      toolName: input.toolName,
      originalPayload: input.originalPayload,
      deliveryAttempts: input.deliveryAttempts,
      finalError: lastAttempt?.errorMessage ?? 'Unknown error',
      finalErrorType: lastAttempt?.errorType ?? 'UNKNOWN',
      agentId: input.agentId,
      swarmId: input.swarmId,
      createdAt: input.deliveryAttempts[0]?.attemptedAt ?? now,
      archivedAt: now,
      status: 'pending',
      tags: input.tags ?? [],
    };

    await this.db.run(
      `INSERT INTO dead_letter_queue
       (message_id, tool_name, original_payload, final_error, final_error_type,
        agent_id, swarm_id, created_at, archived_at, status, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.messageId, entry.toolName, JSON.stringify(entry.originalPayload),
       entry.finalError, entry.finalErrorType, entry.agentId ?? null, entry.swarmId ?? null,
       entry.createdAt, entry.archivedAt, entry.status, JSON.stringify(entry.tags)]
    );

    for (const attempt of input.deliveryAttempts) {
      await this.db.run(
        `INSERT INTO dlq_delivery_attempts
         (message_id, attempt_number, attempted_at, error_type, error_message, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, attempt.attemptNumber, attempt.attemptedAt,
         attempt.errorType, attempt.errorMessage, attempt.latencyMs]
      );
    }

    return entry;
  }
}
```

**Step 4: Implement DLQReader**

Create `v3/@claude-flow/cli/src/dlq/dlq-reader.ts`:

```typescript
import type { DLQEntry } from '@claude-flow/shared/src/types/dlq.js';

export interface DLQListOptions {
  status?: 'pending' | 'replayed' | 'purged';
  toolName?: string;
  agentId?: string;
  olderThanDays?: number;
  limit?: number;
}

export class DLQReader {
  constructor(private db: AgentDBBackend) {}

  async list(opts: DLQListOptions = {}): Promise<DLQEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.status) { conditions.push('d.status = ?'); params.push(opts.status); }
    if (opts.toolName) { conditions.push('d.tool_name = ?'); params.push(opts.toolName); }
    if (opts.agentId) { conditions.push('d.agent_id = ?'); params.push(opts.agentId); }
    if (opts.olderThanDays) {
      const cutoff = new Date(Date.now() - opts.olderThanDays * 86400000).toISOString();
      conditions.push('d.archived_at < ?');
      params.push(cutoff);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 50;

    const rows = await this.db.all(
      `SELECT d.* FROM dead_letter_queue d ${where}
       ORDER BY d.archived_at DESC LIMIT ?`,
      [...params, limit]
    );

    return Promise.all(rows.map(async row => {
      const attempts = await this.db.all(
        'SELECT * FROM dlq_delivery_attempts WHERE message_id = ? ORDER BY attempt_number',
        [row.message_id]
      );
      return this.mapRow(row, attempts);
    }));
  }

  async get(messageId: string): Promise<DLQEntry | null> {
    const row = await this.db.get(
      'SELECT * FROM dead_letter_queue WHERE message_id = ?', [messageId]
    );
    if (!row) return null;
    const attempts = await this.db.all(
      'SELECT * FROM dlq_delivery_attempts WHERE message_id = ? ORDER BY attempt_number',
      [messageId]
    );
    return this.mapRow(row, attempts);
  }

  async purge(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const result = await this.db.run(
      "UPDATE dead_letter_queue SET status = 'purged' WHERE archived_at < ? AND status = 'pending'",
      [cutoff]
    );
    return result.changes ?? 0;
  }

  private mapRow(row: any, attempts: any[]): DLQEntry {
    return {
      messageId: row.message_id,
      toolName: row.tool_name,
      originalPayload: JSON.parse(row.original_payload),
      deliveryAttempts: attempts.map(a => ({
        attemptNumber: a.attempt_number, attemptedAt: a.attempted_at,
        errorType: a.error_type, errorMessage: a.error_message, latencyMs: a.latency_ms
      })),
      finalError: row.final_error, finalErrorType: row.final_error_type,
      agentId: row.agent_id ?? undefined, swarmId: row.swarm_id ?? undefined,
      createdAt: row.created_at, archivedAt: row.archived_at,
      replayedAt: row.replayed_at ?? undefined,
      replayResult: row.replay_result ?? undefined,
      status: row.status, tags: JSON.parse(row.tags),
    };
  }
}
```

**Step 5: Implement DLQReplayer**

Create `v3/@claude-flow/cli/src/dlq/dlq-replayer.ts`:

```typescript
import type { DLQReplayResult } from '@claude-flow/shared/src/types/dlq.js';
import { DLQReader } from './dlq-reader.js';

export class DLQReplayer {
  constructor(
    private db: AgentDBBackend,
    private reader: DLQReader,
    private mcpClient: MCPClient,
  ) {}

  async replay(messageId: string): Promise<DLQReplayResult> {
    const entry = await this.reader.get(messageId);
    if (!entry) throw new Error(`DLQ entry ${messageId} not found`);
    if (entry.status !== 'pending') throw new Error(`Cannot replay entry with status: ${entry.status}`);

    const replayedAt = new Date().toISOString();
    let success = false;
    let errorMessage: string | undefined;

    try {
      await this.mcpClient.callTool(entry.toolName, entry.originalPayload);
      success = true;
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    await this.db.run(
      `UPDATE dead_letter_queue
       SET status = ?, replayed_at = ?, replay_result = ?
       WHERE message_id = ?`,
      [success ? 'replayed' : 'pending', replayedAt,
       success ? 'success' : 'failed_again', messageId]
    );

    return { messageId, success, errorMessage, replayedAt };
  }
}
```

**Step 6: CLI commands**

Create `v3/@claude-flow/cli/src/commands/dlq.ts`:

```typescript
import { Command } from 'commander';
import { DLQReader } from '../dlq/dlq-reader.js';
import { DLQReplayer } from '../dlq/dlq-replayer.js';

export function registerDLQCommand(program: Command): void {
  const cmd = program.command('dlq').description('Dead Letter Queue management');

  cmd.command('list')
    .option('--status <s>', 'Filter: pending|replayed|purged', 'pending')
    .option('--tool <name>', 'Filter by tool name')
    .option('--limit <n>', 'Max results', parseInt, 50)
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const reader = await getDLQReader();
      const entries = await reader.list({ status: opts.status, toolName: opts.tool, limit: opts.limit });
      if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }
      if (entries.length === 0) { console.log('No DLQ entries matching filter.'); return; }
      console.table(entries.map(e => ({
        messageId: e.messageId.slice(0, 8) + '...',
        tool: e.toolName,
        error: e.finalErrorType,
        attempts: e.deliveryAttempts.length,
        archived: e.archivedAt.slice(0, 19),
        status: e.status,
      })));
    });

  cmd.command('inspect')
    .argument('<messageId>', 'DLQ entry message ID')
    .action(async (messageId) => {
      const reader = await getDLQReader();
      const entry = await reader.get(messageId);
      if (!entry) { console.error(`Not found: ${messageId}`); process.exitCode = 1; return; }
      console.log(JSON.stringify(entry, null, 2));
    });

  cmd.command('replay')
    .argument('<messageId>', 'DLQ entry message ID to re-submit')
    .action(async (messageId) => {
      const replayer = await getDLQReplayer();
      const result = await replayer.replay(messageId);
      if (result.success) {
        console.log(`Replayed successfully: ${messageId}`);
      } else {
        console.error(`Replay failed: ${result.errorMessage}`);
        process.exitCode = 1;
      }
    });

  cmd.command('purge')
    .option('--older-than <duration>', 'Duration e.g. 7d, 30d', '7d')
    .description('Mark old pending entries as purged')
    .action(async (opts) => {
      const days = parseDurationDays(opts.olderThan);
      const reader = await getDLQReader();
      const count = await reader.purge(days);
      console.log(`Purged ${count} DLQ entries older than ${opts.olderThan}`);
    });
}

function parseDurationDays(duration: string): number {
  const match = /^(\d+)d$/.exec(duration);
  if (!match) throw new Error(`Invalid duration format: ${duration}. Use e.g. "7d"`);
  return parseInt(match[1], 10);
}
```

## 6. Key Code Templates

**SQLite schema (full, from Step 2):**

```sql
-- Dead Letter Queue main table
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  message_id        TEXT    PRIMARY KEY,
  tool_name         TEXT    NOT NULL,
  original_payload  TEXT    NOT NULL,   -- JSON object
  final_error       TEXT    NOT NULL,
  final_error_type  TEXT    NOT NULL,   -- RATE_LIMIT | TIMEOUT | VALIDATION | UNKNOWN
  agent_id          TEXT,
  swarm_id          TEXT,
  created_at        TEXT    NOT NULL,   -- ISO 8601 first failure
  archived_at       TEXT    NOT NULL,   -- ISO 8601 moved to DLQ
  replayed_at       TEXT,               -- ISO 8601 if replayed
  replay_result     TEXT,               -- 'success' | 'failed_again' | NULL
  status            TEXT    NOT NULL DEFAULT 'pending',  -- pending | replayed | purged
  tags              TEXT    NOT NULL DEFAULT '[]'         -- JSON array
);

-- Individual delivery attempt history
CREATE TABLE IF NOT EXISTS dlq_delivery_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id     TEXT    NOT NULL REFERENCES dead_letter_queue(message_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,      -- 1-based
  attempted_at   TEXT    NOT NULL,      -- ISO 8601
  error_type     TEXT    NOT NULL,
  error_message  TEXT    NOT NULL,
  latency_ms     INTEGER NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dlq_status     ON dead_letter_queue(status);
CREATE INDEX IF NOT EXISTS idx_dlq_tool       ON dead_letter_queue(tool_name);
CREATE INDEX IF NOT EXISTS idx_dlq_agent      ON dead_letter_queue(agent_id);
CREATE INDEX IF NOT EXISTS idx_dlq_swarm      ON dead_letter_queue(swarm_id);
CREATE INDEX IF NOT EXISTS idx_dlq_archived   ON dead_letter_queue(archived_at);
CREATE INDEX IF NOT EXISTS idx_dlq_attempts   ON dlq_delivery_attempts(message_id);
```

**CLI command specs (complete):**

```bash
# List pending DLQ entries (default: status=pending, limit=50)
npx claude-flow@v3alpha dlq list

# List with filters
npx claude-flow@v3alpha dlq list --status pending --tool agent/spawn --limit 20

# Full JSON output for scripting
npx claude-flow@v3alpha dlq list --json

# Inspect a specific entry with full delivery attempt history
npx claude-flow@v3alpha dlq inspect <messageId>

# Replay a failed message (re-submits original payload to the tool)
npx claude-flow@v3alpha dlq replay <messageId>

# Purge entries older than 7 days (marks as 'purged', does not delete rows)
npx claude-flow@v3alpha dlq purge --older-than 7d

# Purge with longer retention
npx claude-flow@v3alpha dlq purge --older-than 30d
```

**DLQEntry JSON example:**

```json
{
  "messageId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "toolName": "agent/spawn",
  "originalPayload": {
    "agentType": "engineering-backend-architect",
    "priority": "high",
    "config": { "taskDescription": "Design the payment service API" }
  },
  "deliveryAttempts": [
    { "attemptNumber": 1, "attemptedAt": "2026-04-06T02:00:00Z", "errorType": "RATE_LIMIT", "errorMessage": "429 Too Many Requests", "latencyMs": 230 },
    { "attemptNumber": 2, "attemptedAt": "2026-04-06T02:00:02Z", "errorType": "RATE_LIMIT", "errorMessage": "429 Too Many Requests", "latencyMs": 190 },
    { "attemptNumber": 3, "attemptedAt": "2026-04-06T02:00:06Z", "errorType": "RATE_LIMIT", "errorMessage": "429 Too Many Requests", "latencyMs": 210 }
  ],
  "finalError": "429 Too Many Requests",
  "finalErrorType": "RATE_LIMIT",
  "createdAt": "2026-04-06T02:00:00Z",
  "archivedAt": "2026-04-06T02:00:06Z",
  "status": "pending",
  "tags": ["rate-limit", "agent/spawn"]
}
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/dlq/dlq-writer.test.ts`):
- `enqueue()` inserts one row into `dead_letter_queue`
- `enqueue()` inserts N rows into `dlq_delivery_attempts` (one per attempt)
- `finalError` and `finalErrorType` are taken from the last delivery attempt
- `createdAt` is set to the first attempt's `attemptedAt`

**Unit tests** (`v3/@claude-flow/cli/tests/dlq/dlq-reader.test.ts`):
- `list()` returns only `status = 'pending'` entries by default
- `list({ toolName: 'agent/spawn' })` filters correctly
- `list({ olderThanDays: 7 })` excludes recent entries
- `get(messageId)` returns full entry with delivery attempts
- `get('nonexistent')` returns `null`
- `purge(7)` updates `status = 'purged'` for entries older than 7 days

**Unit tests** (`v3/@claude-flow/cli/tests/dlq/dlq-replayer.test.ts`):
- `replay()` calls `mcpClient.callTool` with original payload
- On success: updates `status = 'replayed'` and `replay_result = 'success'`
- On failure: keeps `status = 'pending'` and sets `replay_result = 'failed_again'`
- `replay()` throws for non-existent `messageId`
- `replay()` throws for entry with `status !== 'pending'`

**Integration tests** (`v3/@claude-flow/cli/tests/commands/dlq.test.ts`):
- `dlq list` exits 0 and shows correct column headers
- `dlq inspect <id>` prints JSON with all required fields
- `dlq replay <id>` exits 0 when replay succeeds
- `dlq purge --older-than 7d` exits 0 and reports count

**End-to-end test:**
- Simulate a tool failure with 3 retries (from Task 38)
- Verify DLQ entry is created automatically
- `dlq list` shows the entry
- `dlq replay <id>` successfully re-delivers the message

## 8. Definition of Done

- [ ] `dead_letter_queue` and `dlq_delivery_attempts` tables exist in AgentDB after `init`
- [ ] Failed messages (after retry exhaustion from Task 38) automatically appear in `dead_letter_queue`
- [ ] `npx claude-flow@v3alpha dlq list` shows pending entries
- [ ] `npx claude-flow@v3alpha dlq inspect <id>` shows full delivery attempt history
- [ ] `npx claude-flow@v3alpha dlq replay <id>` successfully re-submits message to the original tool
- [ ] `npx claude-flow@v3alpha dlq purge --older-than 7d` updates status without deleting rows
- [ ] All unit and integration tests pass
- [ ] `DLQWriter.enqueue()` is called by the retry layer (Task 38) after `maxAttempts` exhausted
- [ ] TypeScript compiles without errors
