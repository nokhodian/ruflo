# Task 44: Nested Swarm Sub-Conversations

**Priority:** Phase 4 — Advanced Features
**Effort:** Medium
**Depends on:** Task 41 (Isolated Threads — nested chat envelopes require per-pair thread isolation to prevent parent seeing raw sub-swarm transcript), Task 48 (SubGraph Composition — nested swarm IS a sub-graph executed as a child)
**Blocks:** (none)

---

## 1. Current State

Ruflo swarms propagate tasks in a linear chain. There is no nested-chat abstraction: a parent orchestrator that delegates to a sub-swarm sees the full raw transcript from all child agents. HNSW does not index nested transcripts separately.

Relevant files:

- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/swarm-tools.ts` — `swarm_init`, `swarm_status`, `swarm_shutdown` tools. No `spawn_sub_swarm` or `nest` operation exists.
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` (line 152). No `parent_swarm_id` or `nested_chat_mode` field.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/swarm/` — swarm state directory. No envelope or summary generation logic.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB backend. Stores memories flat with no hierarchy; no nested transcript namespace.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts` — CLI swarm command. No `swarm spawn-sub` or `swarm summarize` subcommands.

---

## 2. Gap Analysis

**What is missing:**

1. No `NestedSwarmEnvelope` — no data structure to wrap sub-swarm output with a summary and hide the raw transcript from parent agents.
2. No `spawn_sub_swarm` MCP tool — cannot create a child swarm from within a parent swarm agent.
3. No `SummaryGenerator` — no LLM call to produce a concise summary of sub-swarm work for the parent.
4. No separate HNSW namespace for nested transcripts — parent memory retrieval bleeds in raw sub-swarm messages.
5. No `parent_swarm_id` linkage in AgentDB — sub-swarm lifecycle is not tied to parent.
6. No timeout/budget isolation for sub-swarms — a runaway child can exhaust the parent swarm's budget.

**Concrete failure modes:**

- A top-level coordinator delegates a 3-agent sub-swarm to research a security vulnerability. The parent receives 40 messages of raw research transcript and must process all of them before continuing its own work — context window overflow.
- Sub-swarm errors (agent failures, timeouts) bubble up as raw error strings into the parent context, confusing it rather than returning a structured failure summary.
- Parent orchestrator cannot distinguish between "sub-swarm returned result" and "sub-swarm is still running" because there is no envelope status.
- HNSW memory retrieval in parent session returns sub-agent internal messages that were only meaningful within the sub-swarm context.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/nested-swarm/nested-swarm-envelope.ts` | `NestedSwarmEnvelope` — wraps sub-swarm work; stores raw transcript, exposes only summary |
| `v3/@claude-flow/hooks/src/nested-swarm/summary-generator.ts` | `SummaryGenerator` — calls Claude to produce a summary of sub-swarm transcript |
| `v3/@claude-flow/hooks/src/nested-swarm/sub-swarm-manager.ts` | `SubSwarmManager` — lifecycle management (create, monitor, terminate, summarize) |
| `v3/@claude-flow/hooks/src/nested-swarm/types.ts` | `NestedSwarmConfig`, `NestedSwarmResult`, `SwarmSummary` types |
| `v3/@claude-flow/hooks/src/nested-swarm/index.ts` | Barrel export |
| `v3/@claude-flow/hooks/src/__tests__/nested-swarm.test.ts` | Unit tests for envelope and summary generation |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `v3/mcp/tools/swarm-tools.ts` | Add `spawn_sub_swarm` tool: `parent_swarm_id`, `task`, `max_agents`, `budget_usd`, `timeout_ms`, `summary_prompt`. Returns `sub_swarm_id`. Add `get_sub_swarm_result` tool: returns `NestedSwarmResult` (summary + status, not raw transcript). |
| `v3/mcp/tools/agent-tools.ts` | Add `parent_swarm_id?: string` and `nested_chat_mode: z.boolean().default(false)` to `spawnAgentSchema`. |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `storeNestedTranscript(subSwarmId: string, messages: Message[])` storing to `nested-transcripts:${subSwarmId}` namespace. Parent HNSW searches exclude this namespace by default. |
| `v3/@claude-flow/cli/src/commands/swarm.ts` | Add `swarm spawn-sub --parent <id> --task "<text>" --max-agents <n>` subcommand. Add `swarm result --sub-swarm-id <id>` to fetch the envelope summary. |

---

## 5. Implementation Steps

**Step 1 — Define nested swarm types**

Create `v3/@claude-flow/hooks/src/nested-swarm/types.ts`:

```typescript
export type SubSwarmStatus = 'initializing' | 'running' | 'completed' | 'failed' | 'timed_out';

export interface NestedSwarmConfig {
  parentSwarmId: string;
  task: string;
  maxAgents: number;          // default: 3
  budgetUsd?: number;         // per-sub-swarm budget cap
  timeoutMs: number;          // default: 300_000 (5 min)
  summaryPrompt?: string;     // custom summary instruction
  indexTranscript: boolean;   // whether to HNSW-index the raw transcript separately, default: true
}

export interface SwarmSummary {
  summaryId: string;
  subSwarmId: string;
  text: string;               // concise summary for parent
  keyFindings: string[];      // bullet points
  agentCount: number;
  totalMessages: number;
  elapsedMs: number;
  generatedAt: Date;
}

export interface NestedSwarmResult {
  subSwarmId: string;
  parentSwarmId: string;
  status: SubSwarmStatus;
  summary: SwarmSummary | null;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}
```

**Step 2 — Implement `NestedSwarmEnvelope`**

Create `v3/@claude-flow/hooks/src/nested-swarm/nested-swarm-envelope.ts`. See Key Code Templates.

**Step 3 — Implement `SummaryGenerator`**

Create `v3/@claude-flow/hooks/src/nested-swarm/summary-generator.ts`. See Key Code Templates.

**Step 4 — Implement `SubSwarmManager`**

Create `v3/@claude-flow/hooks/src/nested-swarm/sub-swarm-manager.ts`. See Key Code Templates.

**Step 5 — Add `spawn_sub_swarm` MCP tool**

Edit `v3/mcp/tools/swarm-tools.ts`. Add two new tool definitions after existing swarm tools:

```typescript
// spawn_sub_swarm tool schema
const spawnSubSwarmSchema = z.object({
  parent_swarm_id: z.string().describe('ID of the parent swarm delegating this work'),
  task: z.string().min(10).describe('Task description for the sub-swarm'),
  max_agents: z.number().int().min(1).max(6).default(3),
  budget_usd: z.number().positive().optional().describe('Per-sub-swarm cost cap in USD'),
  timeout_ms: z.number().int().positive().default(300_000),
  summary_prompt: z.string().optional().describe('Custom instruction for summary generation'),
});

// get_sub_swarm_result tool schema
const getSubSwarmResultSchema = z.object({
  sub_swarm_id: z.string().describe('ID returned from spawn_sub_swarm'),
  include_raw_transcript: z.boolean().default(false).describe('WARNING: large. Returns full message history.'),
});
```

**Step 6 — Persist nested transcript to separate namespace**

Edit `v3/@claude-flow/memory/src/agentdb-backend.ts`. Add method:

```typescript
async storeNestedTranscript(subSwarmId: string, messages: Message[]): Promise<void> {
  for (const msg of messages) {
    await this.store(`nested-transcripts:${subSwarmId}:${msg.messageId}`, msg);
  }
}

async getNestedTranscript(subSwarmId: string): Promise<Message[]> {
  const keys = await this.listKeys(`nested-transcripts:${subSwarmId}:`);
  const msgs = await Promise.all(keys.map(k => this.retrieve(k)));
  return (msgs.filter(Boolean) as Message[])
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
```

Modify the HNSW search method to accept an `excludeNamespaces?: string[]` parameter and skip keys that start with excluded prefixes. Default: exclude `nested-transcripts:*` from parent session searches.

**Step 7 — CLI subcommands**

Edit `v3/@claude-flow/cli/src/commands/swarm.ts`. Add:

```typescript
.command('spawn-sub')
.description('Spawn a sub-swarm under a parent swarm')
.requiredOption('--parent <id>', 'Parent swarm ID')
.requiredOption('--task <text>', 'Task for the sub-swarm')
.option('--max-agents <n>', 'Maximum agents', '3')
.option('--timeout-ms <ms>', 'Timeout in milliseconds', '300000')
.action(async (opts) => { /* call spawn_sub_swarm MCP tool */ })

.command('result')
.description('Get the summary result of a completed sub-swarm')
.requiredOption('--sub-swarm-id <id>', 'Sub-swarm ID')
.option('--include-transcript', 'Include full raw transcript (large)')
.action(async (opts) => { /* call get_sub_swarm_result MCP tool */ })
```

**Step 8 — Barrel export**

Create `v3/@claude-flow/hooks/src/nested-swarm/index.ts`:

```typescript
export { NestedSwarmEnvelope } from './nested-swarm-envelope.js';
export { SummaryGenerator } from './summary-generator.js';
export { SubSwarmManager } from './sub-swarm-manager.js';
export type { NestedSwarmConfig, NestedSwarmResult, SwarmSummary, SubSwarmStatus } from './types.js';
```

**Step 9 — Write tests**

Create `v3/@claude-flow/hooks/src/__tests__/nested-swarm.test.ts`. See Testing Strategy.

---

## 6. Key Code Templates

### `nested-swarm-envelope.ts`

```typescript
import { randomBytes } from 'crypto';
import type { NestedSwarmResult, SwarmSummary, SubSwarmStatus } from './types.js';
import type { Message } from '../messaging/types.js';

export class NestedSwarmEnvelope {
  public readonly subSwarmId: string;
  public readonly parentSwarmId: string;
  public readonly task: string;
  private status: SubSwarmStatus = 'initializing';
  private rawMessages: Message[] = [];
  private summary: SwarmSummary | null = null;
  public readonly createdAt: Date = new Date();
  private completedAt: Date | null = null;

  constructor(parentSwarmId: string, task: string) {
    this.subSwarmId = `sub-${randomBytes(8).toString('hex')}`;
    this.parentSwarmId = parentSwarmId;
    this.task = task;
  }

  addMessage(message: Message): void {
    if (this.status !== 'running' && this.status !== 'initializing') {
      throw new Error(`Cannot add messages to envelope in status: ${this.status}`);
    }
    this.status = 'running';
    this.rawMessages.push(message);
  }

  setSummary(summary: SwarmSummary): void {
    this.summary = summary;
  }

  complete(): void {
    this.status = 'completed';
    this.completedAt = new Date();
  }

  fail(error: string): void {
    this.status = 'failed';
    this.completedAt = new Date();
    this._error = error;
  }

  timeout(): void {
    this.status = 'timed_out';
    this.completedAt = new Date();
  }

  /**
   * Returns the result exposed to the PARENT.
   * Only the summary is included — raw transcript is withheld.
   */
  toResult(): NestedSwarmResult {
    return {
      subSwarmId: this.subSwarmId,
      parentSwarmId: this.parentSwarmId,
      status: this.status,
      summary: this.summary,
      error: this._error,
      createdAt: this.createdAt,
      completedAt: this.completedAt ?? undefined,
    };
  }

  getRawMessages(): Message[] {
    return [...this.rawMessages];
  }

  getMessageCount(): number {
    return this.rawMessages.length;
  }

  private _error?: string;
}
```

### `summary-generator.ts`

```typescript
import type { SwarmSummary } from './types.js';
import type { Message } from '../messaging/types.js';
import { randomBytes } from 'crypto';

const DEFAULT_SUMMARY_PROMPT = `You are summarizing the work of a multi-agent sub-swarm for a parent orchestrator.
The parent needs only what is actionable — not the reasoning process.

Produce:
1. A concise summary paragraph (max 3 sentences)
2. A bullet list of KEY FINDINGS (max 5 bullets)

Be specific. Use file paths, function names, and concrete outcomes. Omit discussion and deliberation.`;

export class SummaryGenerator {
  /**
   * Generates a SwarmSummary from the raw message transcript.
   * In production, `llmCall` is injected; in tests, it can be mocked.
   */
  static async generate(
    subSwarmId: string,
    messages: Message[],
    elapsedMs: number,
    customPrompt?: string,
    llmCall: (prompt: string) => Promise<string> = SummaryGenerator.defaultLLMCall
  ): Promise<SwarmSummary> {
    const transcript = messages
      .map(m => `[${m.fromAgentId} → ${m.toAgentId}]: ${m.content}`)
      .join('\n\n');

    const systemPrompt = customPrompt ?? DEFAULT_SUMMARY_PROMPT;
    const userPrompt = `TRANSCRIPT:\n${transcript}\n\nGenerate summary and key findings.`;

    const rawSummary = await llmCall(`${systemPrompt}\n\n${userPrompt}`);

    // Parse key findings from bullet lines
    const bulletLines = rawSummary
      .split('\n')
      .filter(l => /^[-*•]\s+/.test(l.trim()))
      .map(l => l.replace(/^[-*•]\s+/, '').trim())
      .slice(0, 5);

    // Extract summary paragraph (non-bullet lines before first bullet)
    const summaryLines = rawSummary
      .split('\n')
      .filter(l => l.trim() && !/^[-*•\d]/.test(l.trim()))
      .slice(0, 3)
      .join(' ');

    return {
      summaryId: randomBytes(8).toString('hex'),
      subSwarmId,
      text: summaryLines || rawSummary.slice(0, 500),
      keyFindings: bulletLines.length > 0 ? bulletLines : [rawSummary.slice(0, 200)],
      agentCount: new Set(messages.map(m => m.fromAgentId)).size,
      totalMessages: messages.length,
      elapsedMs,
      generatedAt: new Date(),
    };
  }

  private static async defaultLLMCall(prompt: string): Promise<string> {
    // Production: calls Claude Haiku (cost-efficient for summarization)
    // Import and call the appropriate claude-flow LLM client here
    throw new Error('LLM call not configured. Inject llmCall parameter in tests.');
  }
}
```

### `sub-swarm-manager.ts`

```typescript
import { NestedSwarmEnvelope } from './nested-swarm-envelope.js';
import { SummaryGenerator } from './summary-generator.js';
import type { NestedSwarmConfig, NestedSwarmResult } from './types.js';

export class SubSwarmManager {
  private envelopes: Map<string, NestedSwarmEnvelope> = new Map();

  async spawn(config: NestedSwarmConfig): Promise<string> {
    const envelope = new NestedSwarmEnvelope(config.parentSwarmId, config.task);
    this.envelopes.set(envelope.subSwarmId, envelope);

    // Set timeout watchdog
    const timeoutHandle = setTimeout(() => {
      const env = this.envelopes.get(envelope.subSwarmId);
      if (env && env.toResult().status === 'running') {
        env.timeout();
      }
    }, config.timeoutMs);

    // Return the sub-swarm ID immediately; actual agent spawning is async
    void this.runSubSwarm(envelope, config, timeoutHandle);
    return envelope.subSwarmId;
  }

  async getResult(subSwarmId: string): Promise<NestedSwarmResult | null> {
    const envelope = this.envelopes.get(subSwarmId);
    if (!envelope) return null;
    return envelope.toResult();
  }

  private async runSubSwarm(
    envelope: NestedSwarmEnvelope,
    config: NestedSwarmConfig,
    timeoutHandle: ReturnType<typeof setTimeout>
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      // Spawn child agents using the existing swarm coordinator
      // (implementation delegates to v3/mcp/tools/swarm-tools.ts spawn_sub_swarm)
      // Messages flow through ThreadedMessageBus into the envelope
      // ... agent execution happens here ...

      const elapsedMs = Date.now() - startedAt;
      const summary = await SummaryGenerator.generate(
        envelope.subSwarmId,
        envelope.getRawMessages(),
        elapsedMs,
        config.summaryPrompt
      );
      envelope.setSummary(summary);
      envelope.complete();
    } catch (err) {
      envelope.fail((err as Error).message);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export const subSwarmManager = new SubSwarmManager();
```

---

## 7. Testing Strategy

File: `v3/@claude-flow/hooks/src/__tests__/nested-swarm.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { NestedSwarmEnvelope } from '../nested-swarm/nested-swarm-envelope.js';
import { SummaryGenerator } from '../nested-swarm/summary-generator.js';

describe('NestedSwarmEnvelope', () => {
  it('starts in initializing status', () => {
    const env = new NestedSwarmEnvelope('parent-1', 'test task');
    expect(env.toResult().status).toBe('initializing');
  });

  it('transitions to running when first message is added', () => {
    const env = new NestedSwarmEnvelope('parent-1', 'test task');
    env.addMessage({ messageId: 'm1', fromAgentId: 'a1', toAgentId: 'a2', content: 'hello', role: 'user', timestamp: new Date() });
    expect(env.toResult().status).toBe('running');
  });

  it('toResult does not include raw messages', () => {
    const env = new NestedSwarmEnvelope('parent-1', 'test task');
    env.addMessage({ messageId: 'm1', fromAgentId: 'a1', toAgentId: 'a2', content: 'secret internal message', role: 'user', timestamp: new Date() });
    const result = env.toResult();
    // Parent result should have no messages field
    expect((result as any).rawMessages).toBeUndefined();
    expect((result as any).messages).toBeUndefined();
  });

  it('exposes raw messages via getRawMessages (for storage)', () => {
    const env = new NestedSwarmEnvelope('parent-1', 'test task');
    env.addMessage({ messageId: 'm1', fromAgentId: 'a1', toAgentId: 'a2', content: 'internal', role: 'user', timestamp: new Date() });
    expect(env.getRawMessages()).toHaveLength(1);
  });

  it('complete() sets status to completed', () => {
    const env = new NestedSwarmEnvelope('parent-1', 'test task');
    env.complete();
    expect(env.toResult().status).toBe('completed');
  });

  it('fail() sets status to failed and records error', () => {
    const env = new NestedSwarmEnvelope('parent-1', 'test task');
    env.fail('Agent crashed');
    const result = env.toResult();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Agent crashed');
  });

  it('throws when adding messages to a completed envelope', () => {
    const env = new NestedSwarmEnvelope('parent-1', 'test task');
    env.complete();
    expect(() =>
      env.addMessage({ messageId: 'm2', fromAgentId: 'a1', toAgentId: 'a2', content: 'late', role: 'user', timestamp: new Date() })
    ).toThrow('Cannot add messages');
  });
});

describe('SummaryGenerator.generate', () => {
  it('calls the llmCall with transcript content', async () => {
    const mockLLM = vi.fn().mockResolvedValue(
      'The sub-swarm analyzed auth.ts and found two vulnerabilities.\n- JWT validation is missing expiry check\n- Password hashing uses MD5'
    );
    const messages = [
      { messageId: 'm1', fromAgentId: 'researcher', toAgentId: 'coordinator', content: 'Found JWT issue', role: 'user' as const, timestamp: new Date() },
    ];
    const summary = await SummaryGenerator.generate('sub-1', messages, 1500, undefined, mockLLM);
    expect(mockLLM).toHaveBeenCalledWith(expect.stringContaining('TRANSCRIPT'));
    expect(summary.keyFindings.length).toBeGreaterThan(0);
    expect(summary.totalMessages).toBe(1);
    expect(summary.elapsedMs).toBe(1500);
  });

  it('counts unique agent IDs for agentCount', async () => {
    const mockLLM = vi.fn().mockResolvedValue('Summary text.\n- finding 1');
    const messages = [
      { messageId: 'm1', fromAgentId: 'a1', toAgentId: 'coord', content: 'msg', role: 'user' as const, timestamp: new Date() },
      { messageId: 'm2', fromAgentId: 'a2', toAgentId: 'coord', content: 'msg', role: 'user' as const, timestamp: new Date() },
      { messageId: 'm3', fromAgentId: 'a1', toAgentId: 'a2',   content: 'msg', role: 'user' as const, timestamp: new Date() },
    ];
    const summary = await SummaryGenerator.generate('sub-1', messages, 500, undefined, mockLLM);
    expect(summary.agentCount).toBe(2); // a1 and a2
  });
});
```

**Integration test:** Create a sub-swarm with `parent_swarm_id`, run 3 agents, call `get_sub_swarm_result`. Assert:
1. Result contains `summary.text` (non-empty).
2. HNSW search in parent session namespace does NOT return messages from `nested-transcripts:${subSwarmId}:*`.
3. Direct AgentDB lookup via `getNestedTranscript(subSwarmId)` DOES return all messages.

---

## 8. Definition of Done

- [ ] `NestedSwarmEnvelope` correctly hides raw messages from `toResult()`.
- [ ] `SummaryGenerator.generate` produces a `SwarmSummary` with `text` and `keyFindings`.
- [ ] `SubSwarmManager` manages lifecycle (spawn, timeout, complete, fail).
- [ ] `spawn_sub_swarm` MCP tool added to `swarm-tools.ts` with validated schema.
- [ ] `get_sub_swarm_result` MCP tool returns only envelope summary, not raw transcript.
- [ ] Nested transcript stored to `nested-transcripts:${subSwarmId}:*` namespace in AgentDB.
- [ ] Parent HNSW searches exclude `nested-transcripts:*` by default.
- [ ] `swarm spawn-sub` and `swarm result` CLI subcommands implemented.
- [ ] All unit tests in `nested-swarm.test.ts` pass.
- [ ] A live 3-agent sub-swarm produces a summary with at least 1 key finding.
- [ ] Sub-swarm timeout (configurable `timeout_ms`) transitions envelope to `timed_out` and returns partial summary if any messages were collected.
- [ ] TypeScript compiles with zero errors.
