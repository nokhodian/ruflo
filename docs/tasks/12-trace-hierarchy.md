# Task 12: Distributed Trace Hierarchy (Swarm Execution Observability)
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Medium  
**Depends on:** None (foundational observability task)  
**Blocks:** Task 13 (Latency Percentiles), Task 14 (Session Replay), Task 15 (Observability Bus)

---

## 1. Current State

The 17 hooks in `v3/@claude-flow/hooks/src/` fire lifecycle events but each produces isolated telemetry with no shared correlation ID. There is no `Trace`, `AgentSpan`, or `ToolCallEvent` model.

**Relevant files:**
- `v3/@claude-flow/hooks/src/types.ts` — `HookEvent` enum, `HookContext`, `HookHandler`, `HookPriority`
- `v3/@claude-flow/hooks/src/registry/index.ts` — `registerHook`, `unregisterHook`
- `v3/@claude-flow/hooks/src/executor/index.ts` — `executeHooks`, `HookExecutor`
- `v3/@claude-flow/hooks/src/daemons/index.ts` — `DaemonManager`
- `v3/@claude-flow/hooks/src/index.ts` — package exports
- `v3/mcp/tools/agent-tools.ts` — `handleSpawnAgent`, `handleTerminateAgent`, `handleAgentStatus`
- `v3/mcp/tools/hooks-tools.ts` — existing hook-invocation MCP tools

**Hook events that map to trace lifecycle:**

| HookEvent | Trace mapping |
|---|---|
| `AgentSpawn` | Open `AgentSpan` |
| `AgentTerminate` | Close `AgentSpan` |
| `PreToolUse` | Open `ToolCallEvent` |
| `PostToolUse` | Close `ToolCallEvent` with latency |
| `PreTask` | Open root `Trace` |
| `PostTask` | Close root `Trace` |
| `SessionStart` | Attach `sessionId` to `Trace` |

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No `Trace` / `AgentSpan` data models | Cannot correlate 5+ concurrent agent events |
| No `traceId` propagated through hook context | Each hook event is orphaned |
| No `ToolCallEvent` with timing | Cannot measure tool-level latency |
| No persistent trace store | Traces lost on process exit |
| No trace read API | Tools 14 and 15 have nothing to read |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/observability/trace.ts` | `Trace`, `AgentSpan`, `ToolCallEvent`, `TokenUsage` interfaces + `TraceStore` class |
| `v3/@claude-flow/hooks/src/observability/trace-collector.ts` | Hooks wired to `HookEvent.*` that populate the `TraceStore` |
| `v3/@claude-flow/hooks/src/observability/index.ts` | Re-exports for the observability sub-package |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/@claude-flow/hooks/src/types.ts` | Add optional `traceId` and `spanId` fields to `HookContext` | Correlation ID propagation |
| `v3/@claude-flow/hooks/src/index.ts` | Export `TraceStore`, `Trace`, `AgentSpan`, `TraceCollector` | External access for Task 14/15 |
| `v3/mcp/tools/agent-tools.ts` | In `handleSpawnAgent`, generate and attach a `spanId` to the response; in `handleTerminateAgent`, emit span-close event | Span lifecycle |

---

## 5. Implementation Steps

**Step 1 — Add `traceId` and `spanId` to `HookContext` in `types.ts`**

Add to the `HookContext` interface (after `timestamp`):
```typescript
/** Distributed trace correlation ID — propagated through all hooks in a task */
traceId?: string;
/** Span ID for the specific agent or operation that fired this hook */
spanId?: string;
```

**Step 2 — Create `v3/@claude-flow/hooks/src/observability/trace.ts`**

```typescript
import Database from 'better-sqlite3';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface ToolCallEvent {
  toolCallId: string;
  spanId: string;
  traceId: string;
  tool: string;
  input: unknown;
  output?: unknown;
  startedAt: number;    // epoch ms
  endedAt?: number;
  latencyMs?: number;
  error?: string;
}

export interface AgentSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;     // for nested sub-swarms
  agentSlug: string;
  startedAt: number;         // epoch ms
  endedAt?: number;
  tokenUsage?: TokenUsage;
  toolCalls: ToolCallEvent[];
  retryCount: number;
  status: 'running' | 'success' | 'error';
  errorMessage?: string;
}

export interface Trace {
  traceId: string;
  sessionId: string;
  taskDescription: string;
  startedAt: number;         // epoch ms
  endedAt?: number;
  spans: AgentSpan[];
  status: 'running' | 'success' | 'error';
}

export class TraceStore {
  private db: Database.Database;
  private activeTraces: Map<string, Trace> = new Map();
  private activeSpans: Map<string, AgentSpan> = new Map();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        trace_id         TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        task_description TEXT NOT NULL,
        started_at       INTEGER NOT NULL,
        ended_at         INTEGER,
        status           TEXT NOT NULL DEFAULT 'running'
      );
      CREATE TABLE IF NOT EXISTS agent_spans (
        span_id          TEXT PRIMARY KEY,
        trace_id         TEXT NOT NULL,
        parent_span_id   TEXT,
        agent_slug       TEXT NOT NULL,
        started_at       INTEGER NOT NULL,
        ended_at         INTEGER,
        input_tokens     INTEGER,
        output_tokens    INTEGER,
        cost_usd         REAL,
        retry_count      INTEGER NOT NULL DEFAULT 0,
        status           TEXT NOT NULL DEFAULT 'running',
        error_message    TEXT,
        FOREIGN KEY (trace_id) REFERENCES traces(trace_id)
      );
      CREATE TABLE IF NOT EXISTS tool_call_events (
        tool_call_id     TEXT PRIMARY KEY,
        span_id          TEXT NOT NULL,
        trace_id         TEXT NOT NULL,
        tool             TEXT NOT NULL,
        input_json       TEXT NOT NULL,
        output_json      TEXT,
        started_at       INTEGER NOT NULL,
        ended_at         INTEGER,
        latency_ms       INTEGER,
        error            TEXT,
        FOREIGN KEY (span_id) REFERENCES agent_spans(span_id)
      );
      CREATE INDEX IF NOT EXISTS idx_spans_trace ON agent_spans(trace_id);
      CREATE INDEX IF NOT EXISTS idx_tools_span  ON tool_call_events(span_id);
      CREATE INDEX IF NOT EXISTS idx_spans_started ON agent_spans(started_at);
    `);
  }

  startTrace(traceId: string, sessionId: string, taskDescription: string): Trace {
    const trace: Trace = {
      traceId,
      sessionId,
      taskDescription,
      startedAt: Date.now(),
      spans: [],
      status: 'running',
    };
    this.activeTraces.set(traceId, trace);
    this.db.prepare(`
      INSERT OR IGNORE INTO traces (trace_id, session_id, task_description, started_at, status)
      VALUES (?, ?, ?, ?, 'running')
    `).run(traceId, sessionId, taskDescription, trace.startedAt);
    return trace;
  }

  endTrace(traceId: string, status: 'success' | 'error'): void {
    const endedAt = Date.now();
    this.db.prepare(
      'UPDATE traces SET ended_at = ?, status = ? WHERE trace_id = ?'
    ).run(endedAt, status, traceId);
    this.activeTraces.delete(traceId);
  }

  startSpan(span: Omit<AgentSpan, 'toolCalls' | 'retryCount' | 'status'>): AgentSpan {
    const fullSpan: AgentSpan = {
      ...span,
      toolCalls: [],
      retryCount: 0,
      status: 'running',
    };
    this.activeSpans.set(span.spanId, fullSpan);
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_spans
        (span_id, trace_id, parent_span_id, agent_slug, started_at, status)
      VALUES (?, ?, ?, ?, ?, 'running')
    `).run(span.spanId, span.traceId, span.parentSpanId ?? null, span.agentSlug, span.startedAt);
    return fullSpan;
  }

  endSpan(
    spanId: string,
    status: 'success' | 'error',
    tokenUsage?: TokenUsage,
    errorMessage?: string
  ): void {
    const endedAt = Date.now();
    this.db.prepare(`
      UPDATE agent_spans
      SET ended_at = ?, status = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, error_message = ?
      WHERE span_id = ?
    `).run(
      endedAt,
      status,
      tokenUsage?.inputTokens ?? null,
      tokenUsage?.outputTokens ?? null,
      tokenUsage?.costUsd ?? null,
      errorMessage ?? null,
      spanId
    );
    this.activeSpans.delete(spanId);
  }

  recordToolCall(event: ToolCallEvent): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO tool_call_events
        (tool_call_id, span_id, trace_id, tool, input_json, output_json, started_at, ended_at, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.toolCallId,
      event.spanId,
      event.traceId,
      event.tool,
      JSON.stringify(event.input),
      event.output ? JSON.stringify(event.output) : null,
      event.startedAt,
      event.endedAt ?? null,
      event.latencyMs ?? null,
      event.error ?? null
    );
  }

  getTrace(traceId: string): Trace | undefined {
    const row = this.db.prepare('SELECT * FROM traces WHERE trace_id = ?').get(traceId) as any;
    if (!row) return undefined;

    const spanRows = this.db.prepare(
      'SELECT * FROM agent_spans WHERE trace_id = ? ORDER BY started_at ASC'
    ).all(traceId) as any[];

    const spans: AgentSpan[] = spanRows.map(sr => {
      const toolRows = this.db.prepare(
        'SELECT * FROM tool_call_events WHERE span_id = ? ORDER BY started_at ASC'
      ).all(sr.span_id) as any[];

      return {
        spanId: sr.span_id,
        traceId: sr.trace_id,
        parentSpanId: sr.parent_span_id ?? undefined,
        agentSlug: sr.agent_slug,
        startedAt: sr.started_at,
        endedAt: sr.ended_at ?? undefined,
        tokenUsage: sr.input_tokens != null
          ? { inputTokens: sr.input_tokens, outputTokens: sr.output_tokens, costUsd: sr.cost_usd }
          : undefined,
        toolCalls: toolRows.map(tr => ({
          toolCallId: tr.tool_call_id,
          spanId: tr.span_id,
          traceId: tr.trace_id,
          tool: tr.tool,
          input: JSON.parse(tr.input_json),
          output: tr.output_json ? JSON.parse(tr.output_json) : undefined,
          startedAt: tr.started_at,
          endedAt: tr.ended_at ?? undefined,
          latencyMs: tr.latency_ms ?? undefined,
          error: tr.error ?? undefined,
        })),
        retryCount: 0,
        status: sr.status,
        errorMessage: sr.error_message ?? undefined,
      };
    });

    return {
      traceId: row.trace_id,
      sessionId: row.session_id,
      taskDescription: row.task_description,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      spans,
      status: row.status,
    };
  }

  listRecentTraces(limit = 20): Array<Omit<Trace, 'spans'>> {
    const rows = this.db.prepare(
      'SELECT * FROM traces ORDER BY started_at DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map(r => ({
      traceId: r.trace_id,
      sessionId: r.session_id,
      taskDescription: r.task_description,
      startedAt: r.started_at,
      endedAt: r.ended_at ?? undefined,
      status: r.status,
    }));
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 3 — Create `v3/@claude-flow/hooks/src/observability/trace-collector.ts`**

```typescript
import { registerHook } from '../registry/index.js';
import { HookEvent, HookPriority, type HookContext } from '../types.js';
import { TraceStore, type ToolCallEvent } from './trace.js';
import { randomBytes } from 'node:crypto';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
}

export class TraceCollector {
  private pendingToolCalls: Map<string, { spanId: string; traceId: string; startedAt: number }> = new Map();

  constructor(private store: TraceStore) {}

  register(): void {
    // PreTask → open root Trace
    registerHook({
      event: HookEvent.PreTask,
      priority: HookPriority.High,
      handler: async (ctx: HookContext) => {
        const traceId   = newId('trace');
        const sessionId = (ctx.data?.sessionId as string) ?? 'unknown-session';
        const taskDesc  = (ctx.data?.description as string) ?? '';
        this.store.startTrace(traceId, sessionId, taskDesc);
        // Inject traceId into context for downstream hooks
        (ctx as any).traceId = traceId;
        return { success: true, metadata: { traceId } };
      },
    });

    // PostTask → close root Trace
    registerHook({
      event: HookEvent.PostTask,
      priority: HookPriority.Low,
      handler: async (ctx: HookContext) => {
        const traceId = ctx.traceId;
        if (traceId) {
          const success = !(ctx.data?.error);
          this.store.endTrace(traceId, success ? 'success' : 'error');
        }
        return { success: true };
      },
    });

    // AgentSpawn → open AgentSpan
    registerHook({
      event: HookEvent.AgentSpawn,
      priority: HookPriority.High,
      handler: async (ctx: HookContext) => {
        const traceId  = ctx.traceId ?? newId('trace');
        const spanId   = newId('span');
        const agentSlug = (ctx.data?.agentType as string) ?? 'unknown';
        this.store.startSpan({ spanId, traceId, agentSlug, startedAt: Date.now() });
        (ctx as any).spanId = spanId;
        return { success: true, metadata: { spanId } };
      },
    });

    // AgentTerminate → close AgentSpan
    registerHook({
      event: HookEvent.AgentTerminate,
      priority: HookPriority.Low,
      handler: async (ctx: HookContext) => {
        const spanId = ctx.spanId;
        if (spanId) {
          const status  = (ctx.data?.error ? 'error' : 'success') as 'success' | 'error';
          const tokens  = ctx.data?.tokenUsage as any;
          this.store.endSpan(spanId, status, tokens, ctx.data?.error as string | undefined);
        }
        return { success: true };
      },
    });

    // PreToolUse → start timing
    registerHook({
      event: HookEvent.PreToolUse,
      priority: HookPriority.High,
      handler: async (ctx: HookContext) => {
        const toolCallId = newId('tc');
        this.pendingToolCalls.set(toolCallId, {
          spanId: ctx.spanId ?? 'unknown',
          traceId: ctx.traceId ?? 'unknown',
          startedAt: Date.now(),
        });
        (ctx as any).toolCallId = toolCallId;
        return { success: true, metadata: { toolCallId } };
      },
    });

    // PostToolUse → record ToolCallEvent
    registerHook({
      event: HookEvent.PostToolUse,
      priority: HookPriority.Low,
      handler: async (ctx: HookContext) => {
        const toolCallId = (ctx as any).toolCallId as string | undefined;
        const pending    = toolCallId ? this.pendingToolCalls.get(toolCallId) : undefined;
        if (pending && toolCallId) {
          const endedAt = Date.now();
          const event: ToolCallEvent = {
            toolCallId,
            spanId: pending.spanId,
            traceId: pending.traceId,
            tool: (ctx.data?.tool as string) ?? 'unknown',
            input: ctx.data?.input,
            output: ctx.data?.output,
            startedAt: pending.startedAt,
            endedAt,
            latencyMs: endedAt - pending.startedAt,
            error: ctx.data?.error as string | undefined,
          };
          this.store.recordToolCall(event);
          this.pendingToolCalls.delete(toolCallId);
        }
        return { success: true };
      },
    });
  }
}
```

**Step 4 — Create `v3/@claude-flow/hooks/src/observability/index.ts`**

```typescript
export { TraceStore, type Trace, type AgentSpan, type ToolCallEvent, type TokenUsage } from './trace.js';
export { TraceCollector } from './trace-collector.js';
```

**Step 5 — Update `v3/@claude-flow/hooks/src/index.ts`**

Add:
```typescript
export {
  TraceStore,
  TraceCollector,
  type Trace,
  type AgentSpan,
  type ToolCallEvent,
  type TokenUsage,
} from './observability/index.js';
```

---

## 6. Key Code Templates

### Initializing TraceStore + TraceCollector in daemon startup
```typescript
import { TraceStore, TraceCollector } from '@claude-flow/hooks';

const traceStore = new TraceStore(
  process.env.TRACE_DB_PATH ?? './data/observability/traces.db'
);
const collector = new TraceCollector(traceStore);
collector.register();
```

### Reading a trace (for Task 14 replay)
```typescript
const trace = traceStore.getTrace('trace-1a2b3c4d-...');
// trace.spans[0].toolCalls[0].latencyMs
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/hooks/src/observability/trace.test.ts`**
```typescript
describe('TraceStore', () => {
  it('creates a trace and retrieves it by id', () => { ... });
  it('startSpan/endSpan round-trips to SQLite', () => { ... });
  it('recordToolCall stores latencyMs correctly', () => { ... });
  it('getTrace assembles nested spans + tool calls', () => { ... });
  it('listRecentTraces returns most recent first', () => { ... });
});
```

**Integration — hook wiring test**
```typescript
describe('TraceCollector', () => {
  it('creates a trace on PreTask and closes it on PostTask', async () => { ... });
  it('creates a span on AgentSpawn with the correct traceId', async () => { ... });
  it('records tool call timing from PreToolUse to PostToolUse', async () => { ... });
});
```

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/hooks/src/observability/trace.ts` exists and compiles
- [ ] `v3/@claude-flow/hooks/src/observability/trace-collector.ts` exists and compiles
- [ ] SQLite schema created (traces, agent_spans, tool_call_events tables)
- [ ] `traceId` and `spanId` added to `HookContext` in `types.ts`
- [ ] `TraceStore` and `TraceCollector` exported from package index
- [ ] `getTrace()` returns fully assembled `Trace` with nested spans and tool calls
- [ ] Unit tests pass for `TraceStore`
- [ ] Integration test shows trace opened and closed via hook events
- [ ] No `any` in public API (private `any` for SQLite rows is acceptable)
