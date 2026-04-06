# Task 41: Isolated Thread per Agent Pair

**Priority:** Phase 4 — Advanced Features
**Effort:** Medium
**Depends on:** Task 48 (SubGraph Composition — agent pair topology must be established before threads can be keyed per pair)
**Blocks:** Task 44 (Nested Swarms — nested chat envelopes require isolated threads to prevent parent context bleed)

---

## 1. Current State

Ruflo today has no isolated conversation threading between agent pairs. All inter-agent messages pass through a single shared bus with no partitioning by sender/receiver pair.

Relevant files:

- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `handleSpawnAgent` at line 236; spawned agents share the same `swarmCoordinator` context with no thread isolation. The `spawnAgentSchema` (line 152) has no `thread_id` or `conversation_scope` field.
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/swarm-tools.ts` — swarm coordination tools; no thread registry exists.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/index.ts` — background worker index; no `ThreadedMessageBus` worker registered.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB storage layer used for message persistence.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/swarm/` — swarm state management; messages are not partitioned by pair.

---

## 2. Gap Analysis

**What is missing:**

1. No `ConversationThread` abstraction — agent pairs share a flat message history.
2. No `ThreadedMessageBus` — any agent can observe all messages from any other agent.
3. No per-pair context window budget enforcement.
4. `spawnAgentSchema` in `agent-tools.ts` has no `thread_id` parameter; callers cannot request isolation.
5. AgentDB has no thread-keyed namespace for conversation partitioning.

**Concrete failure modes:**

- In a 6-agent swarm (coordinator + 5 specialists), Agent B's conversation with Agent C leaks into Agent A's context window. Claude context usage grows as `O(n² × message_length)` instead of `O(n × message_length)`.
- A reviewer agent that was co-participant in a security audit obtains implementation details it should not know, breaking the need-to-know principle in sensitive workflows.
- Context window overflows on swarms with > 8 agents running concurrent dialogues, causing 400 errors from the Anthropic API.
- Debugging becomes impossible: a trace shows messages from multiple conversations interleaved with no way to separate them.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/messaging/conversation-thread.ts` | `ConversationThread` class — single directed pair's isolated history |
| `v3/@claude-flow/hooks/src/messaging/threaded-message-bus.ts` | `ThreadedMessageBus` — thread registry keyed by `${from}:${to}` |
| `v3/@claude-flow/hooks/src/messaging/types.ts` | Shared message types: `AgentId`, `Message`, `ThreadStats` |
| `v3/@claude-flow/hooks/src/messaging/index.ts` | Barrel export for messaging subsystem |
| `v3/@claude-flow/hooks/src/__tests__/threaded-message-bus.test.ts` | Unit tests for thread isolation |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `v3/mcp/tools/agent-tools.ts` | Add `thread_id?: string` and `conversation_scope: 'isolated' \| 'broadcast'` to `spawnAgentSchema` (line 152). Wire into `handleSpawnAgent` to register a thread on the bus. |
| `v3/@claude-flow/hooks/src/workers/index.ts` | Export `ThreadedMessageBus` as a singleton available to all workers. |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `storeThreadMessage(threadKey: string, message: Message)` and `getThreadHistory(threadKey: string): Message[]` methods using AgentDB namespace `threads:*`. |
| `v3/@claude-flow/hooks/src/swarm/` (swarm coordinator file) | Replace raw message dispatch with `ThreadedMessageBus.getThread(from, to).send(message)` calls. |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Add `--conversation-scope` flag to `agent spawn` subcommand. |

---

## 5. Implementation Steps

**Step 1 — Define message types**

Create `v3/@claude-flow/hooks/src/messaging/types.ts`:

```typescript
export type AgentId = string;

export interface Message {
  messageId: string;
  fromAgentId: AgentId;
  toAgentId: AgentId;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ThreadStats {
  threadKey: string;
  messageCount: number;
  totalTokensEstimate: number;
  createdAt: Date;
  lastActivityAt: Date;
}
```

**Step 2 — Implement `ConversationThread`**

Create `v3/@claude-flow/hooks/src/messaging/conversation-thread.ts`. See Key Code Templates section below.

**Step 3 — Implement `ThreadedMessageBus`**

Create `v3/@claude-flow/hooks/src/messaging/threaded-message-bus.ts`. See Key Code Templates section below.

**Step 4 — Persist threads in AgentDB**

Edit `v3/@claude-flow/memory/src/agentdb-backend.ts`. Add two methods:

```typescript
async storeThreadMessage(threadKey: string, message: Message): Promise<void> {
  await this.store(`threads:${threadKey}:${message.messageId}`, message);
}

async getThreadHistory(threadKey: string): Promise<Message[]> {
  const keys = await this.listKeys(`threads:${threadKey}:`);
  const messages = await Promise.all(keys.map(k => this.retrieve(k)));
  return (messages.filter(Boolean) as Message[])
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
```

**Step 5 — Wire `ThreadedMessageBus` into spawn**

Edit `v3/mcp/tools/agent-tools.ts`:

1. Import `threadedMessageBus` singleton from `../../@claude-flow/hooks/src/messaging/index.js`.
2. Extend `spawnAgentSchema` at line 152 with:
   ```typescript
   thread_id: z.string().optional().describe('Explicit thread ID; auto-generated if omitted'),
   conversation_scope: z.enum(['isolated', 'broadcast']).default('isolated'),
   ```
3. In `handleSpawnAgent`, after generating `agentId`, call:
   ```typescript
   if (input.conversation_scope === 'isolated' && context?.parentAgentId) {
     const thread = threadedMessageBus.getThread(context.parentAgentId, agentId);
     thread.setMaxTokens(input.config?.maxThreadTokens as number ?? 32_000);
   }
   ```

**Step 6 — Add barrel export**

Create `v3/@claude-flow/hooks/src/messaging/index.ts`:

```typescript
export { ConversationThread } from './conversation-thread.js';
export { ThreadedMessageBus, threadedMessageBus } from './threaded-message-bus.js';
export type { AgentId, Message, ThreadStats } from './types.js';
```

**Step 7 — Write unit tests**

Create `v3/@claude-flow/hooks/src/__tests__/threaded-message-bus.test.ts`. See Testing Strategy section.

**Step 8 — CLI flag**

Edit `v3/@claude-flow/cli/src/commands/agent.ts`. In the `spawn` subcommand options, add:
```typescript
.option('--conversation-scope <scope>', 'isolated | broadcast (default: isolated)', 'isolated')
```
Pass through to the MCP `agent/spawn` call.

---

## 6. Key Code Templates

### `conversation-thread.ts`

```typescript
import { randomBytes } from 'crypto';
import type { AgentId, Message, ThreadStats } from './types.js';

export class ConversationThread {
  private messages: Message[] = [];
  private maxTokens: number = 32_000;
  private tokenCount: number = 0;
  public readonly createdAt: Date = new Date();
  public lastActivityAt: Date = new Date();

  constructor(
    public readonly fromAgentId: AgentId,
    public readonly toAgentId: AgentId,
    public readonly threadKey: string = `${fromAgentId}:${toAgentId}`
  ) {}

  setMaxTokens(max: number): void {
    this.maxTokens = max;
  }

  send(content: string, role: Message['role'] = 'user'): Message {
    const estimatedTokens = Math.ceil(content.length / 4);

    if (this.tokenCount + estimatedTokens > this.maxTokens) {
      // Evict oldest non-system messages until under budget
      this.evictOldest(estimatedTokens);
    }

    const message: Message = {
      messageId: randomBytes(8).toString('hex'),
      fromAgentId: this.fromAgentId,
      toAgentId: this.toAgentId,
      content,
      role,
      timestamp: new Date(),
    };

    this.messages.push(message);
    this.tokenCount += estimatedTokens;
    this.lastActivityAt = new Date();
    return message;
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  getStats(): ThreadStats {
    return {
      threadKey: this.threadKey,
      messageCount: this.messages.length,
      totalTokensEstimate: this.tokenCount,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  clear(): void {
    this.messages = [];
    this.tokenCount = 0;
  }

  private evictOldest(neededTokens: number): void {
    while (this.tokenCount + neededTokens > this.maxTokens && this.messages.length > 0) {
      const evicted = this.messages.shift();
      if (evicted) {
        this.tokenCount -= Math.ceil(evicted.content.length / 4);
      }
    }
  }
}
```

### `threaded-message-bus.ts`

```typescript
import { ConversationThread } from './conversation-thread.js';
import type { AgentId, ThreadStats } from './types.js';

export class ThreadedMessageBus {
  private threads: Map<string, ConversationThread> = new Map();

  /**
   * Returns the isolated thread for a directed agent pair.
   * Creates one on first access. The key is directional: A→B != B→A.
   */
  getThread(from: AgentId, to: AgentId): ConversationThread {
    const key = `${from}:${to}`;
    if (!this.threads.has(key)) {
      this.threads.set(key, new ConversationThread(from, to, key));
    }
    return this.threads.get(key)!;
  }

  /**
   * Returns the bidirectional thread pair for agents A and B.
   * Useful for dialogue-style communication.
   */
  getPair(agentA: AgentId, agentB: AgentId): [ConversationThread, ConversationThread] {
    return [this.getThread(agentA, agentB), this.getThread(agentB, agentA)];
  }

  /**
   * Returns all threads involving a given agent (as sender or receiver).
   */
  getAgentThreads(agentId: AgentId): ConversationThread[] {
    return Array.from(this.threads.values()).filter(
      t => t.fromAgentId === agentId || t.toAgentId === agentId
    );
  }

  /**
   * Cleans up all threads for a terminated agent.
   */
  terminateAgent(agentId: AgentId): void {
    for (const [key, thread] of this.threads.entries()) {
      if (thread.fromAgentId === agentId || thread.toAgentId === agentId) {
        thread.clear();
        this.threads.delete(key);
      }
    }
  }

  getAllStats(): ThreadStats[] {
    return Array.from(this.threads.values()).map(t => t.getStats());
  }

  /** Total number of active threads in the bus */
  get size(): number {
    return this.threads.size;
  }
}

// Singleton exported for use across the system
export const threadedMessageBus = new ThreadedMessageBus();
```

---

## 7. Testing Strategy

File: `v3/@claude-flow/hooks/src/__tests__/threaded-message-bus.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadedMessageBus } from '../messaging/threaded-message-bus.js';

describe('ThreadedMessageBus', () => {
  let bus: ThreadedMessageBus;

  beforeEach(() => {
    bus = new ThreadedMessageBus();
  });

  it('creates distinct threads for different agent pairs', () => {
    const threadAB = bus.getThread('agent-a', 'agent-b');
    const threadAC = bus.getThread('agent-a', 'agent-c');
    expect(threadAB).not.toBe(threadAC);
  });

  it('returns the same thread object on repeated calls for the same pair', () => {
    const t1 = bus.getThread('agent-a', 'agent-b');
    const t2 = bus.getThread('agent-a', 'agent-b');
    expect(t1).toBe(t2);
  });

  it('treats A→B and B→A as separate threads (directional isolation)', () => {
    const tAB = bus.getThread('agent-a', 'agent-b');
    const tBA = bus.getThread('agent-b', 'agent-a');
    expect(tAB).not.toBe(tBA);
  });

  it('messages sent on thread A→B are not visible on thread A→C', () => {
    const tAB = bus.getThread('agent-a', 'agent-b');
    const tAC = bus.getThread('agent-a', 'agent-c');
    tAB.send('secret message for B');
    expect(tAC.getHistory()).toHaveLength(0);
    expect(tAB.getHistory()).toHaveLength(1);
  });

  it('evicts oldest messages when token budget is exceeded', () => {
    const thread = bus.getThread('agent-a', 'agent-b');
    thread.setMaxTokens(10); // ~40 characters max
    thread.send('a'.repeat(20)); // ~5 tokens
    thread.send('b'.repeat(20)); // ~5 tokens — now at budget
    thread.send('c'.repeat(20)); // ~5 tokens — should evict first message
    const history = thread.getHistory();
    expect(history[0].content).not.toBe('a'.repeat(20));
    expect(history.length).toBeLessThanOrEqual(2);
  });

  it('terminateAgent removes all threads involving that agent', () => {
    bus.getThread('agent-a', 'agent-b');
    bus.getThread('agent-b', 'agent-c');
    bus.getThread('agent-a', 'agent-c');
    bus.terminateAgent('agent-b');
    expect(bus.size).toBe(1); // only a→c survives
  });

  it('getAllStats returns stats for every active thread', () => {
    bus.getThread('x', 'y').send('hello');
    bus.getThread('x', 'z').send('world');
    const stats = bus.getAllStats();
    expect(stats).toHaveLength(2);
    expect(stats.every(s => s.messageCount === 1)).toBe(true);
  });
});
```

**Additional integration test:** spawn two pairs of agents via MCP `agent/spawn` with `conversation_scope: 'isolated'`, send messages, and assert that each agent's context only contains its own pair's history (use `agentdb-backend` `getThreadHistory` to verify).

---

## 8. Definition of Done

- [ ] `ConversationThread` class fully implemented with eviction and stats.
- [ ] `ThreadedMessageBus` singleton exported from `messaging/index.ts`.
- [ ] `spawnAgentSchema` in `agent-tools.ts` includes `thread_id` and `conversation_scope` fields.
- [ ] `handleSpawnAgent` registers threads on the bus when `conversation_scope === 'isolated'`.
- [ ] AgentDB persists and retrieves thread history via `threads:*` namespace.
- [ ] All 7 unit tests in `threaded-message-bus.test.ts` pass.
- [ ] `agent spawn --conversation-scope isolated` CLI flag works end-to-end.
- [ ] Agent termination via `agent/terminate` MCP tool calls `terminateAgent` on the bus, freeing memory.
- [ ] A 6-agent swarm test confirms no cross-pair message bleed (verified by inspecting per-thread history).
- [ ] TypeScript compiles with zero errors (`npm run build` in `v3/@claude-flow/hooks`).
