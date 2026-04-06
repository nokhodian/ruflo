# Task 14: Session Replay for Failure Diagnosis
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Medium  
**Depends on:** Task 12 (Trace Hierarchy — `TraceStore` with full Trace/Span/ToolCallEvent data)  
**Blocks:** None

---

## 1. Current State

There is no mechanism to reconstruct the exact sequence of agent actions after a failure. The `TraceStore` created in Task 12 holds the raw data; what is missing is a reader and CLI renderer.

**Relevant files after Task 12:**
- `v3/@claude-flow/hooks/src/observability/trace.ts` — `TraceStore`, `Trace`, `AgentSpan`, `ToolCallEvent`
- `v3/@claude-flow/hooks/src/observability/index.ts` — exports
- `v3/@claude-flow/hooks/src/index.ts` — package re-exports
- `v3/@claude-flow/cli/src/commands/index.ts` — CLI command registry
- `v3/mcp/tools/index.ts` — MCP tool registry

**What is missing:**
- `ReplayReader` class that reconstructs a `Trace` into an ordered timeline of events
- `replay` CLI command (`npx claude-flow@v3alpha replay --trace-id <id>`)
- `replay/get` MCP tool for programmatic access
- Optional `--from-span` flag to start replay mid-trace
- Pretty-print renderer for the CLI

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No replay CLI | Engineers must write raw SQL to debug production failures |
| No `--from-span` | Cannot replay from the point of failure in a long trace |
| No timeline reconstruction | Events are in 3 separate tables with no merged view |
| No MCP tool | Agents cannot introspect their own past runs |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/observability/replay-reader.ts` | Merges spans + tool calls into a chronological `TimelineEvent[]`; supports start-from-span |
| `v3/@claude-flow/cli/src/commands/replay.ts` | CLI command `replay` with `--trace-id`, `--from-span`, `--format`, `--show-tokens` |
| `v3/mcp/tools/replay-tools.ts` | MCP tool `replay/get` returning `ReplayTimeline` |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/@claude-flow/hooks/src/observability/index.ts` | Export `ReplayReader`, `TimelineEvent`, `ReplayTimeline` | External access |
| `v3/@claude-flow/hooks/src/index.ts` | Re-export from observability | Package consumers |
| `v3/@claude-flow/cli/src/commands/index.ts` | Register `replay` command | CLI routing |
| `v3/mcp/tools/index.ts` | Add `replayTools` | MCP registration |

---

## 5. Implementation Steps

**Step 1 — Create `v3/@claude-flow/hooks/src/observability/replay-reader.ts`**

```typescript
import { TraceStore, type Trace, type AgentSpan, type ToolCallEvent } from './trace.js';

export type TimelineEventKind =
  | 'trace.start'
  | 'trace.end'
  | 'span.start'
  | 'span.end'
  | 'tool.call'
  | 'tool.result';

export interface TimelineEvent {
  kind: TimelineEventKind;
  timestampMs: number;
  traceId: string;
  spanId?: string;
  toolCallId?: string;
  agentSlug?: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  latencyMs?: number;
  tokens?: { input: number; output: number };
  error?: string;
  status?: string;
}

export interface ReplayTimeline {
  traceId: string;
  sessionId: string;
  taskDescription: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  events: TimelineEvent[];
  totalDurationMs: number;
  totalSpans: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export class ReplayReader {
  constructor(private readonly store: TraceStore) {}

  /**
   * Build a chronological timeline from a Trace.
   * @param traceId  The trace to replay
   * @param fromSpanId  If provided, only include events at or after this span's start
   */
  buildTimeline(traceId: string, fromSpanId?: string): ReplayTimeline {
    const trace = this.store.getTrace(traceId);
    if (!trace) throw new Error(`Trace not found: ${traceId}`);

    // Determine start cutoff if fromSpanId given
    let cutoffMs = 0;
    if (fromSpanId) {
      const span = trace.spans.find(s => s.spanId === fromSpanId);
      if (!span) throw new Error(`Span not found: ${fromSpanId}`);
      cutoffMs = span.startedAt;
    }

    const events: TimelineEvent[] = [];

    // Root trace events
    if (trace.startedAt >= cutoffMs) {
      events.push({
        kind: 'trace.start',
        timestampMs: trace.startedAt,
        traceId,
        status: 'running',
      });
    }

    for (const span of trace.spans) {
      if (span.startedAt < cutoffMs) continue;

      events.push({
        kind: 'span.start',
        timestampMs: span.startedAt,
        traceId,
        spanId: span.spanId,
        agentSlug: span.agentSlug,
      });

      for (const tc of span.toolCalls) {
        if (tc.startedAt < cutoffMs) continue;

        events.push({
          kind: 'tool.call',
          timestampMs: tc.startedAt,
          traceId,
          spanId: tc.spanId,
          toolCallId: tc.toolCallId,
          agentSlug: span.agentSlug,
          tool: tc.tool,
          input: tc.input,
        });

        if (tc.endedAt !== undefined) {
          events.push({
            kind: 'tool.result',
            timestampMs: tc.endedAt,
            traceId,
            spanId: tc.spanId,
            toolCallId: tc.toolCallId,
            agentSlug: span.agentSlug,
            tool: tc.tool,
            output: tc.output,
            latencyMs: tc.latencyMs,
            error: tc.error,
          });
        }
      }

      if (span.endedAt !== undefined) {
        events.push({
          kind: 'span.end',
          timestampMs: span.endedAt,
          traceId,
          spanId: span.spanId,
          agentSlug: span.agentSlug,
          status: span.status,
          tokens: span.tokenUsage
            ? { input: span.tokenUsage.inputTokens, output: span.tokenUsage.outputTokens }
            : undefined,
          error: span.errorMessage,
        });
      }
    }

    if (trace.endedAt !== undefined && trace.endedAt >= cutoffMs) {
      events.push({
        kind: 'trace.end',
        timestampMs: trace.endedAt,
        traceId,
        status: trace.status,
      });
    }

    // Sort chronologically
    events.sort((a, b) => a.timestampMs - b.timestampMs);

    // Aggregate stats
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    for (const span of trace.spans) {
      totalInputTokens += span.tokenUsage?.inputTokens ?? 0;
      totalOutputTokens += span.tokenUsage?.outputTokens ?? 0;
    }
    const toolCallEvents = events.filter(e => e.kind === 'tool.call');
    const totalDurationMs = (trace.endedAt ?? Date.now()) - trace.startedAt;

    return {
      traceId,
      sessionId: trace.sessionId,
      taskDescription: trace.taskDescription,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt,
      status: trace.status,
      events,
      totalDurationMs,
      totalSpans: trace.spans.length,
      totalToolCalls: toolCallEvents.length,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  listTraces(limit = 20): Array<{ traceId: string; sessionId: string; taskDescription: string; startedAt: number; status: string }> {
    return this.store.listRecentTraces(limit);
  }
}
```

**Step 2 — Create `v3/@claude-flow/cli/src/commands/replay.ts`**

```typescript
import { Command } from 'commander';
import { TraceStore, ReplayReader, type TimelineEvent } from '@claude-flow/hooks';

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('T', ' ').slice(0, 23);
}

function renderEvent(event: TimelineEvent, showTokens: boolean): string {
  const ts = formatTimestamp(event.timestampMs);
  const spanLabel = event.spanId ? `[${event.spanId.slice(-8)}]` : '          ';

  switch (event.kind) {
    case 'trace.start':
      return `${ts}  TRACE START   ${spanLabel}`;
    case 'trace.end':
      return `${ts}  TRACE END     ${spanLabel} status=${event.status}`;
    case 'span.start':
      return `${ts}  AGENT START   ${spanLabel} agent=${event.agentSlug}`;
    case 'span.end': {
      const tokenStr = showTokens && event.tokens
        ? ` in=${event.tokens.input} out=${event.tokens.output}`
        : '';
      const errStr = event.error ? ` error=${event.error}` : '';
      return `${ts}  AGENT END     ${spanLabel} agent=${event.agentSlug} status=${event.status}${tokenStr}${errStr}`;
    }
    case 'tool.call':
      return `${ts}  TOOL CALL     ${spanLabel} agent=${event.agentSlug} tool=${event.tool}`;
    case 'tool.result': {
      const latStr = event.latencyMs ? ` (${event.latencyMs}ms)` : '';
      const errStr = event.error ? ` ERROR: ${event.error}` : '';
      return `${ts}  TOOL RESULT   ${spanLabel} tool=${event.tool}${latStr}${errStr}`;
    }
    default:
      return `${ts}  UNKNOWN       ${spanLabel}`;
  }
}

export function buildReplayCommand(): Command {
  const cmd = new Command('replay');
  cmd.description('Replay a past agent trace for failure diagnosis');

  cmd
    .option('--trace-id <id>', 'Trace ID to replay')
    .option('--from-span <spanId>', 'Start replay from this span (inclusive)')
    .option('--format <fmt>', 'Output format: timeline | json', 'timeline')
    .option('--show-tokens', 'Show token counts in output', false)
    .option('--list', 'List recent traces instead of replaying one')
    .action(async (opts) => {
      const dbPath = process.env.TRACE_DB_PATH ?? './data/observability/traces.db';
      const store = new TraceStore(dbPath);
      const reader = new ReplayReader(store);

      try {
        if (opts.list) {
          const traces = reader.listTraces(20);
          if (opts.format === 'json') {
            console.log(JSON.stringify(traces, null, 2));
          } else {
            console.log('Recent Traces:');
            for (const t of traces) {
              console.log(
                `  ${t.traceId}  ${new Date(t.startedAt).toISOString()}  [${t.status}]  ${t.taskDescription.slice(0, 60)}`
              );
            }
          }
          return;
        }

        if (!opts.traceId) {
          console.error('Error: --trace-id is required (or use --list to see recent traces)');
          process.exit(1);
        }

        const timeline = reader.buildTimeline(opts.traceId, opts.fromSpan);

        if (opts.format === 'json') {
          console.log(JSON.stringify(timeline, null, 2));
          return;
        }

        // Timeline format
        console.log(`\nTrace: ${timeline.traceId}`);
        console.log(`Task:  ${timeline.taskDescription}`);
        console.log(`Duration: ${timeline.totalDurationMs}ms  |  Spans: ${timeline.totalSpans}  |  Tool calls: ${timeline.totalToolCalls}`);
        if (opts.showTokens) {
          console.log(`Tokens: in=${timeline.totalInputTokens} out=${timeline.totalOutputTokens}`);
        }
        console.log('─'.repeat(90));

        for (const event of timeline.events) {
          console.log(renderEvent(event, opts.showTokens));
        }

        if (timeline.status === 'error') {
          const errorSpans = timeline.events.filter(e => e.kind === 'span.end' && e.error);
          if (errorSpans.length > 0) {
            console.log('\n[FAILURES]');
            for (const e of errorSpans) {
              console.error(`  Agent: ${e.agentSlug}  Error: ${e.error}`);
            }
          }
        }
      } finally {
        store.close();
      }
    });

  return cmd;
}
```

**Step 3 — Create `v3/mcp/tools/replay-tools.ts`**

```typescript
import { z } from 'zod';
import { MCPTool } from '../types.js';
import { TraceStore, ReplayReader } from '@claude-flow/hooks';

let _reader: ReplayReader | null = null;
export function setReplayReader(r: ReplayReader): void { _reader = r; }

function getReader(): ReplayReader {
  if (!_reader) throw new Error('ReplayReader not initialized');
  return _reader;
}

export const replayGetTool: MCPTool = {
  name: 'replay/get',
  description: 'Get the full replay timeline for a trace, optionally starting from a specific span',
  inputSchema: {
    type: 'object',
    properties: {
      traceId:    { type: 'string', description: 'Trace ID to replay' },
      fromSpanId: { type: 'string', description: 'Start timeline from this span ID (optional)' },
    },
    required: ['traceId'],
  },
  handler: async (input) => {
    const schema = z.object({
      traceId:    z.string(),
      fromSpanId: z.string().optional(),
    });
    const { traceId, fromSpanId } = schema.parse(input);
    return getReader().buildTimeline(traceId, fromSpanId);
  },
  category: 'observability',
  tags: ['replay', 'trace', 'debug'],
  version: '1.0.0',
};

export const replayListTool: MCPTool = {
  name: 'replay/list',
  description: 'List recent traces available for replay',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max traces to return (default 20)', default: 20 },
    },
  },
  handler: async (input) => {
    const { limit } = z.object({ limit: z.number().default(20) }).parse(input);
    return { traces: getReader().listTraces(limit) };
  },
  category: 'observability',
  tags: ['replay', 'trace', 'list'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 10_000,
};

export const replayTools: MCPTool[] = [replayGetTool, replayListTool];
export default replayTools;
```

**Step 4 — Update observability index**

In `v3/@claude-flow/hooks/src/observability/index.ts`, add:
```typescript
export { ReplayReader, type TimelineEvent, type TimelineEventKind, type ReplayTimeline } from './replay-reader.js';
```

**Step 5 — Register CLI command**

In `v3/@claude-flow/cli/src/commands/index.ts`:
```typescript
import { buildReplayCommand } from './replay.js';
program.addCommand(buildReplayCommand());
```

**Step 6 — Register MCP tools**

In `v3/mcp/tools/index.ts`, add `replayTools` to the all-tools array.

---

## 6. Key Code Templates

### CLI usage examples
```bash
# List recent traces
npx claude-flow@v3alpha replay --list

# Replay a full trace as a timeline
npx claude-flow@v3alpha replay --trace-id trace-1a2b3c4d-xxxx

# Start replay from a specific span (failure point)
npx claude-flow@v3alpha replay --trace-id trace-1a2b3c4d-xxxx --from-span span-ab12cd34-xxxx

# JSON output for programmatic processing
npx claude-flow@v3alpha replay --trace-id trace-1a2b3c4d-xxxx --format json | jq '.events[] | select(.kind == "span.end" and .error)'

# Show token counts
npx claude-flow@v3alpha replay --trace-id trace-1a2b3c4d-xxxx --show-tokens
```

### ReplayTimeline shape (abbreviated)
```typescript
{
  traceId: "trace-...",
  sessionId: "sess-...",
  taskDescription: "Run security audit",
  startedAt: 1743936000000,
  endedAt: 1743936120000,
  status: "error",
  totalDurationMs: 120000,
  totalSpans: 3,
  totalToolCalls: 14,
  totalInputTokens: 42000,
  totalOutputTokens: 8000,
  events: [
    { kind: "trace.start", timestampMs: 1743936000000, traceId: "..." },
    { kind: "span.start",  timestampMs: 1743936001000, spanId: "...", agentSlug: "engineering-security-engineer" },
    { kind: "tool.call",   timestampMs: 1743936002000, tool: "Bash", input: { cmd: "..." } },
    ...
  ]
}
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/hooks/src/observability/replay-reader.test.ts`**
```typescript
describe('ReplayReader', () => {
  it('builds chronological timeline from trace with 2 spans', () => {
    // Assert events are sorted by timestampMs ASC
    // Assert span.start appears before tool.call appears before span.end
  });
  it('fromSpanId filters out earlier events', () => {
    // Span A starts at t=100, Span B starts at t=500
    // buildTimeline(traceId, spanB.spanId) should omit Span A events
  });
  it('throws when trace not found', () => { ... });
  it('throws when fromSpanId not in trace', () => { ... });
  it('aggregates totalInputTokens across all spans', () => { ... });
});
```

**CLI integration test:**
```bash
TRACE_DB_PATH=./test-traces.db npx claude-flow@v3alpha replay --list --format json | jq 'length'
```

**MCP tool test:**
```typescript
describe('replay/get', () => {
  it('returns ReplayTimeline for valid traceId', async () => { ... });
  it('returns timeline starting from fromSpanId', async () => { ... });
  it('throws for unknown traceId', async () => { ... });
});
```

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/hooks/src/observability/replay-reader.ts` compiles
- [ ] `ReplayReader`, `TimelineEvent`, `ReplayTimeline` exported from hooks package
- [ ] `replay` CLI command renders timeline table without error
- [ ] `--from-span` correctly filters events to only those at/after the span start
- [ ] `--format json` outputs valid JSON
- [ ] `replay/get` and `replay/list` MCP tools registered
- [ ] Unit tests pass for `ReplayReader.buildTimeline()`
- [ ] `--list` shows recent traces with status and description
- [ ] Error spans highlighted in output when `trace.status === 'error'`
