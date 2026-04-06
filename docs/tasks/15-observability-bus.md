# Task 15: Unified Observability Bus
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Medium  
**Depends on:** Task 12 (Trace Hierarchy — `TraceStore` and hook integration patterns established)  
**Blocks:** None

---

## 1. Current State

17 hooks, background workers (daemons), and MCP tool calls produce disconnected telemetry. Each hook fires independently with no shared event stream. There is no single subscriber point for "everything that happened in this swarm."

**Relevant files:**
- `v3/@claude-flow/hooks/src/types.ts` — `HookEvent`, `HookContext`, `HookHandler`
- `v3/@claude-flow/hooks/src/registry/index.ts` — `registerHook`
- `v3/@claude-flow/hooks/src/executor/index.ts` — `executeHooks`
- `v3/@claude-flow/hooks/src/daemons/index.ts` — `DaemonManager`, `MetricsDaemon`
- `v3/@claude-flow/hooks/src/observability/trace.ts` — `TraceStore` (Task 12)
- `v3/@claude-flow/hooks/src/observability/index.ts` — observability exports
- `v3/@claude-flow/hooks/src/index.ts` — package exports

**What is missing:**
- A typed `ObservabilityEvent` discriminated union covering all system event types
- An `ObservabilityBus` with `publish()` and `subscribe()` API
- Sinks: AgentDB (persistent), CLI stream (real-time TUI), optional OpenTelemetry export
- Hook wiring so all 17 hooks auto-publish to the bus as `ObservabilityEvent`
- Background worker heartbeat events published to the bus

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No `ObservabilityBus` | Cannot subscribe to all swarm events from one place |
| No typed event discriminated union | Third-party tools cannot safely consume events |
| No CLI streaming sink | Cannot watch live swarm execution in the terminal |
| No OpenTelemetry sink | Cannot forward to Jaeger/Datadog/Honeycomb |
| Hooks are disconnected | ReasoningBank, TraceStore, LatencyReporter all register separately — no fan-out |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/observability/bus.ts` | `ObservabilityEvent` union type + `ObservabilityBus` class (subscribe/publish/sinks) |
| `v3/@claude-flow/hooks/src/observability/bus-hook-bridge.ts` | Wires all 17 `HookEvent` types to `ObservabilityBus.publish()` using `registerHook` |
| `v3/@claude-flow/hooks/src/observability/sinks/cli-sink.ts` | Formats `ObservabilityEvent` as colored terminal output; streams via stdout |
| `v3/@claude-flow/hooks/src/observability/sinks/agentdb-sink.ts` | Persists `ObservabilityEvent` to AgentDB/SQLite (delegates to `TraceStore`) |
| `v3/@claude-flow/hooks/src/observability/sinks/otel-sink.ts` | Optional OpenTelemetry OTLP export; no-ops if `@opentelemetry/sdk-node` not installed |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/@claude-flow/hooks/src/observability/index.ts` | Export `ObservabilityBus`, `ObservabilityEvent`, `BusHookBridge` and all sink classes | External access |
| `v3/@claude-flow/hooks/src/index.ts` | Re-export observability exports | Package consumers |
| `v3/@claude-flow/hooks/src/daemons/index.ts` | Publish `daemon.heartbeat` events to the bus in `MetricsDaemon` | Daemon visibility |

---

## 5. Implementation Steps

**Step 1 — Create `v3/@claude-flow/hooks/src/observability/bus.ts`**

```typescript
export type ObservabilityEvent =
  | { type: 'agent.start';       traceId: string; spanId: string; agentSlug: string; taskId: string; timestampMs: number }
  | { type: 'agent.complete';    traceId: string; spanId: string; agentSlug: string; taskId: string; tokens: TokenUsageEvent; durationMs: number; timestampMs: number }
  | { type: 'agent.error';       traceId: string; spanId: string; agentSlug: string; taskId: string; error: string; timestampMs: number }
  | { type: 'tool.call';         traceId: string; spanId: string; toolCallId: string; agentSlug: string; tool: string; input: unknown; timestampMs: number }
  | { type: 'tool.result';       traceId: string; spanId: string; toolCallId: string; tool: string; output: unknown; latencyMs: number; error?: string; timestampMs: number }
  | { type: 'retry';             traceId: string; spanId: string; agentSlug: string; attempt: number; reason: string; timestampMs: number }
  | { type: 'checkpoint';        swarmId: string; step: number; stateHash: string; timestampMs: number }
  | { type: 'consensus';         protocol: string; decision: unknown; quorumAchieved: boolean; timestampMs: number }
  | { type: 'session.start';     sessionId: string; timestampMs: number }
  | { type: 'session.end';       sessionId: string; durationMs: number; timestampMs: number }
  | { type: 'daemon.heartbeat';  daemonName: string; status: string; timestampMs: number }
  | { type: 'routing.decision';  taskDescription: string; agentSlug: string; confidence: number; method: string; timestampMs: number };

export interface TokenUsageEvent {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export type Unsubscribe = () => void;
export type EventHandler = (event: ObservabilityEvent) => void | Promise<void>;

export interface ObservabilityBusSink {
  name: string;
  handle(event: ObservabilityEvent): void | Promise<void>;
}

export class ObservabilityBus {
  private handlers: Set<EventHandler> = new Set();
  private sinks: ObservabilityBusSink[] = [];
  private eventBuffer: ObservabilityEvent[] = [];
  private readonly maxBufferSize: number;

  constructor(maxBufferSize = 10_000) {
    this.maxBufferSize = maxBufferSize;
  }

  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(handler: EventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Add a persistent or streaming sink */
  addSink(sink: ObservabilityBusSink): void {
    this.sinks.push(sink);
  }

  removeSink(name: string): void {
    this.sinks = this.sinks.filter(s => s.name !== name);
  }

  /** Publish an event to all subscribers and sinks */
  publish(event: ObservabilityEvent): void {
    // Buffer for late subscribers
    if (this.eventBuffer.length >= this.maxBufferSize) {
      this.eventBuffer.shift();
    }
    this.eventBuffer.push(event);

    // Fan-out to direct subscribers
    for (const handler of this.handlers) {
      void Promise.resolve(handler(event)).catch(err =>
        console.error('[ObservabilityBus] subscriber error:', err)
      );
    }

    // Fan-out to sinks
    for (const sink of this.sinks) {
      void Promise.resolve(sink.handle(event)).catch(err =>
        console.error(`[ObservabilityBus] sink ${sink.name} error:`, err)
      );
    }
  }

  /** Replay buffered events to a new subscriber */
  replay(handler: EventHandler, filter?: (e: ObservabilityEvent) => boolean): void {
    const events = filter ? this.eventBuffer.filter(filter) : this.eventBuffer;
    for (const event of events) {
      void Promise.resolve(handler(event));
    }
  }

  /** Convenience: publish and await all sinks (for testing) */
  async publishSync(event: ObservabilityEvent): Promise<void> {
    this.eventBuffer.push(event);
    await Promise.all([
      ...[...this.handlers].map(h => Promise.resolve(h(event))),
      ...this.sinks.map(s => Promise.resolve(s.handle(event))),
    ]);
  }
}

/** Singleton bus — initialized once at startup */
export const globalObservabilityBus = new ObservabilityBus();
```

**Step 2 — Create `v3/@claude-flow/hooks/src/observability/bus-hook-bridge.ts`**

```typescript
import { registerHook } from '../registry/index.js';
import { HookEvent, HookPriority } from '../types.js';
import { globalObservabilityBus, type ObservabilityEvent } from './bus.js';

/**
 * Bridges all 17 HookEvent types to ObservabilityBus.publish().
 * Call BusHookBridge.register() once at startup.
 */
export class BusHookBridge {
  constructor(private bus = globalObservabilityBus) {}

  register(): void {
    // Agent lifecycle
    registerHook({
      event: HookEvent.AgentSpawn,
      priority: HookPriority.Background,
      handler: async (ctx) => {
        this.bus.publish({
          type: 'agent.start',
          traceId: ctx.traceId ?? 'unknown',
          spanId: ctx.spanId ?? 'unknown',
          agentSlug: (ctx.data?.agentType as string) ?? 'unknown',
          taskId: (ctx.data?.taskId as string) ?? 'unknown',
          timestampMs: ctx.timestamp.getTime(),
        });
        return { success: true };
      },
    });

    registerHook({
      event: HookEvent.AgentTerminate,
      priority: HookPriority.Background,
      handler: async (ctx) => {
        const hasError = !!(ctx.data?.error);
        const tokens = ctx.data?.tokenUsage as any;
        const event: ObservabilityEvent = hasError
          ? {
              type: 'agent.error',
              traceId: ctx.traceId ?? 'unknown',
              spanId: ctx.spanId ?? 'unknown',
              agentSlug: (ctx.data?.agentType as string) ?? 'unknown',
              taskId: (ctx.data?.taskId as string) ?? 'unknown',
              error: String(ctx.data?.error),
              timestampMs: ctx.timestamp.getTime(),
            }
          : {
              type: 'agent.complete',
              traceId: ctx.traceId ?? 'unknown',
              spanId: ctx.spanId ?? 'unknown',
              agentSlug: (ctx.data?.agentType as string) ?? 'unknown',
              taskId: (ctx.data?.taskId as string) ?? 'unknown',
              tokens: {
                inputTokens: tokens?.inputTokens ?? 0,
                outputTokens: tokens?.outputTokens ?? 0,
                costUsd: tokens?.costUsd,
              },
              durationMs: (ctx.data?.durationMs as number) ?? 0,
              timestampMs: ctx.timestamp.getTime(),
            };
        this.bus.publish(event);
        return { success: true };
      },
    });

    // Tool lifecycle
    registerHook({
      event: HookEvent.PreToolUse,
      priority: HookPriority.Background,
      handler: async (ctx) => {
        this.bus.publish({
          type: 'tool.call',
          traceId: ctx.traceId ?? 'unknown',
          spanId: ctx.spanId ?? 'unknown',
          toolCallId: (ctx as any).toolCallId ?? 'unknown',
          agentSlug: (ctx.data?.agentSlug as string) ?? 'unknown',
          tool: (ctx.data?.tool as string) ?? 'unknown',
          input: ctx.data?.input,
          timestampMs: ctx.timestamp.getTime(),
        });
        return { success: true };
      },
    });

    registerHook({
      event: HookEvent.PostToolUse,
      priority: HookPriority.Background,
      handler: async (ctx) => {
        this.bus.publish({
          type: 'tool.result',
          traceId: ctx.traceId ?? 'unknown',
          spanId: ctx.spanId ?? 'unknown',
          toolCallId: (ctx as any).toolCallId ?? 'unknown',
          tool: (ctx.data?.tool as string) ?? 'unknown',
          output: ctx.data?.output,
          latencyMs: (ctx.data?.latencyMs as number) ?? 0,
          error: ctx.data?.error as string | undefined,
          timestampMs: ctx.timestamp.getTime(),
        });
        return { success: true };
      },
    });

    // Session lifecycle
    registerHook({
      event: HookEvent.SessionStart,
      priority: HookPriority.Background,
      handler: async (ctx) => {
        this.bus.publish({
          type: 'session.start',
          sessionId: (ctx.data?.sessionId as string) ?? 'unknown',
          timestampMs: ctx.timestamp.getTime(),
        });
        return { success: true };
      },
    });

    registerHook({
      event: HookEvent.SessionEnd,
      priority: HookPriority.Background,
      handler: async (ctx) => {
        this.bus.publish({
          type: 'session.end',
          sessionId: (ctx.data?.sessionId as string) ?? 'unknown',
          durationMs: (ctx.data?.durationMs as number) ?? 0,
          timestampMs: ctx.timestamp.getTime(),
        });
        return { success: true };
      },
    });
  }
}
```

**Step 3 — Create `v3/@claude-flow/hooks/src/observability/sinks/cli-sink.ts`**

```typescript
import type { ObservabilityBusSink, ObservabilityEvent } from '../bus.js';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function colorize(text: string, color: keyof typeof COLORS): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function ts(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(11, 23); // HH:mm:ss.mmm
}

function formatEvent(event: ObservabilityEvent): string {
  switch (event.type) {
    case 'agent.start':
      return `${colorize('[AGENT START]', 'green')} ${event.agentSlug} span=${event.spanId.slice(-8)}`;
    case 'agent.complete':
      return `${colorize('[AGENT DONE ]', 'green')} ${event.agentSlug} ${event.durationMs}ms in=${event.tokens.inputTokens} out=${event.tokens.outputTokens}`;
    case 'agent.error':
      return `${colorize('[AGENT ERROR]', 'red')} ${event.agentSlug}: ${event.error}`;
    case 'tool.call':
      return `${colorize('[TOOL CALL  ]', 'cyan')} ${event.agentSlug} → ${event.tool}`;
    case 'tool.result': {
      const errPart = event.error ? colorize(` ERROR: ${event.error}`, 'red') : '';
      return `${colorize('[TOOL RESULT]', 'cyan')} ${event.tool} (${event.latencyMs}ms)${errPart}`;
    }
    case 'retry':
      return `${colorize('[RETRY      ]', 'yellow')} ${event.agentSlug} attempt=${event.attempt} reason=${event.reason}`;
    case 'session.start':
      return `${colorize('[SESSION    ]', 'blue')} started id=${event.sessionId}`;
    case 'session.end':
      return `${colorize('[SESSION    ]', 'blue')} ended id=${event.sessionId} duration=${event.durationMs}ms`;
    case 'daemon.heartbeat':
      return `${colorize('[DAEMON     ]', 'dim')} ${event.daemonName} status=${event.status}`;
    default:
      return `${colorize('[EVENT      ]', 'dim')} ${(event as any).type}`;
  }
}

export class CLISink implements ObservabilityBusSink {
  readonly name = 'cli';
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  handle(event: ObservabilityEvent): void {
    if (!this.enabled) return;
    const timeStr = ts(event.timestampMs);
    const line = formatEvent(event);
    process.stdout.write(`${timeStr} ${line}\n`);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
```

**Step 4 — Create `v3/@claude-flow/hooks/src/observability/sinks/agentdb-sink.ts`**

```typescript
import type { ObservabilityBusSink, ObservabilityEvent } from '../bus.js';
import type { TraceStore } from '../trace.js';

/**
 * Delegates 'agent.*' and 'tool.*' events to the TraceStore (Task 12).
 * Other event types are stored as raw JSON blobs in a separate bus_events table.
 */
export class AgentDBSink implements ObservabilityBusSink {
  readonly name = 'agentdb';

  constructor(private readonly store: TraceStore) {}

  handle(event: ObservabilityEvent): void {
    // Trace-related events are already handled by TraceCollector (Task 12).
    // This sink provides a secondary raw log for non-trace events.
    if (
      event.type === 'daemon.heartbeat' ||
      event.type === 'checkpoint' ||
      event.type === 'consensus' ||
      event.type === 'routing.decision'
    ) {
      (this.store as any).db.prepare(`
        CREATE TABLE IF NOT EXISTS bus_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          payload    TEXT NOT NULL,
          occurred_at INTEGER NOT NULL
        )
      `).run();

      (this.store as any).db.prepare(
        'INSERT INTO bus_events (event_type, payload, occurred_at) VALUES (?, ?, ?)'
      ).run(event.type, JSON.stringify(event), event.timestampMs);
    }
  }
}
```

**Step 5 — Create `v3/@claude-flow/hooks/src/observability/sinks/otel-sink.ts`**

```typescript
import type { ObservabilityBusSink, ObservabilityEvent } from '../bus.js';

/**
 * Optional OpenTelemetry OTLP export sink.
 * No-ops if @opentelemetry/sdk-node is not installed.
 */
export class OTelSink implements ObservabilityBusSink {
  readonly name = 'otel';
  private tracer: any;

  constructor(private readonly serviceName = 'ruflo-agent') {
    this.initTracer();
  }

  private initTracer(): void {
    try {
      // Dynamic import to avoid hard dependency
      const { NodeTracerProvider } = require('@opentelemetry/sdk-node');
      const { trace } = require('@opentelemetry/api');
      const provider = new NodeTracerProvider();
      provider.register();
      this.tracer = trace.getTracer(this.serviceName);
    } catch {
      // OTel not available — sink becomes a no-op
      this.tracer = null;
    }
  }

  handle(event: ObservabilityEvent): void {
    if (!this.tracer) return;

    try {
      if (event.type === 'agent.start') {
        const span = this.tracer.startSpan(`agent.${event.agentSlug}`);
        span.setAttribute('trace.id', event.traceId);
        span.setAttribute('span.id', event.spanId);
        // Store span for closing on agent.complete/error
        (this as any)[event.spanId] = span;
      } else if (event.type === 'agent.complete' || event.type === 'agent.error') {
        const span = (this as any)[event.spanId];
        if (span) {
          if (event.type === 'agent.error') {
            span.recordException(new Error(event.error));
            span.setStatus({ code: 2, message: event.error }); // ERROR
          }
          span.end();
          delete (this as any)[event.spanId];
        }
      }
    } catch {
      // Never fail the bus due to OTel errors
    }
  }
}
```

**Step 6 — Update `v3/@claude-flow/hooks/src/observability/index.ts`**

Add:
```typescript
export {
  ObservabilityBus,
  globalObservabilityBus,
  type ObservabilityEvent,
  type TokenUsageEvent,
  type Unsubscribe,
  type EventHandler,
  type ObservabilityBusSink,
} from './bus.js';
export { BusHookBridge } from './bus-hook-bridge.js';
export { CLISink } from './sinks/cli-sink.js';
export { AgentDBSink } from './sinks/agentdb-sink.js';
export { OTelSink } from './sinks/otel-sink.js';
```

**Step 7 — Wire everything in daemon startup (`daemons/index.ts`)**

```typescript
import {
  globalObservabilityBus,
  BusHookBridge,
  CLISink,
  AgentDBSink,
} from '../observability/index.js';
import { TraceStore } from '../observability/trace.js';

const traceStore = new TraceStore(process.env.TRACE_DB_PATH ?? './data/observability/traces.db');

// Sinks
const cliSink = new CLISink(process.env.RUFLO_STREAM_EVENTS === '1');
const agentdbSink = new AgentDBSink(traceStore);
globalObservabilityBus.addSink(cliSink);
globalObservabilityBus.addSink(agentdbSink);

// Wire hooks → bus
new BusHookBridge(globalObservabilityBus).register();
```

---

## 6. Key Code Templates

### Subscribing from anywhere
```typescript
import { globalObservabilityBus } from '@claude-flow/hooks';

const unsubscribe = globalObservabilityBus.subscribe(async (event) => {
  if (event.type === 'agent.error') {
    await alertPagerDuty(event.agentSlug, event.error);
  }
});

// Later:
unsubscribe();
```

### Publishing a custom event
```typescript
globalObservabilityBus.publish({
  type: 'routing.decision',
  taskDescription: 'audit the auth system',
  agentSlug: 'engineering-security-engineer',
  confidence: 0.91,
  method: 'semantic',
  timestampMs: Date.now(),
});
```

### Enabling live CLI stream
```bash
RUFLO_STREAM_EVENTS=1 npx claude-flow@v3alpha swarm run security-audit
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/hooks/src/observability/bus.test.ts`**
```typescript
describe('ObservabilityBus', () => {
  it('delivers event to all subscribers', async () => {
    const bus = new ObservabilityBus();
    const received: ObservabilityEvent[] = [];
    bus.subscribe(e => { received.push(e); });
    await bus.publishSync({ type: 'session.start', sessionId: 'test', timestampMs: Date.now() });
    expect(received).toHaveLength(1);
  });
  it('delivers event to all sinks', async () => { ... });
  it('unsubscribe() stops delivery', async () => { ... });
  it('replay() delivers buffered events to late subscriber', async () => { ... });
  it('buffers up to maxBufferSize events (evicts oldest)', () => { ... });
});
```

**Unit — `v3/@claude-flow/hooks/src/observability/sinks/cli-sink.test.ts`**
```typescript
describe('CLISink', () => {
  it('writes agent.start event to stdout', () => {
    // Capture process.stdout.write
  });
  it('no-ops when disabled', () => { ... });
});
```

**Integration:**
- Wire `BusHookBridge` on a test hook executor
- Fire `HookEvent.AgentSpawn` via `executeHooks`
- Assert `globalObservabilityBus.eventBuffer` contains `{ type: 'agent.start', ... }`

---

## 8. Definition of Done

- [ ] `ObservabilityBus` with `subscribe()`, `publish()`, `addSink()`, `replay()` compiles
- [ ] `ObservabilityEvent` discriminated union covers all 12 event types
- [ ] `BusHookBridge.register()` wires `AgentSpawn`, `AgentTerminate`, `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd` to the bus
- [ ] `CLISink` outputs colored lines when `RUFLO_STREAM_EVENTS=1`
- [ ] `AgentDBSink` persists non-trace events to `bus_events` table
- [ ] `OTelSink` no-ops cleanly when `@opentelemetry/sdk-node` is absent
- [ ] `globalObservabilityBus` singleton exported from hooks package
- [ ] Unit tests pass for `ObservabilityBus`
- [ ] Integration test confirms hook → bus → sink delivery chain
