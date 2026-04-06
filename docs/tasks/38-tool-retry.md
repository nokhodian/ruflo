# Task 38: Tool Failure Retry with Exponential Backoff
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Low
**Depends on:** (none — foundational; can be built independently)
**Blocks:** Task 37 (Dead Letter Queue — receives messages after retry exhaustion)

## 1. Current State

MCP tool calls in ruflo fail immediately on any error. There is no retry logic anywhere in the tool execution path:

- `v3/mcp/tools/agent-tools.ts` — `handleSpawnAgent` and related handlers catch errors and return them without retry
- `v3/mcp/tools/task-tools.ts` — task tool handlers do the same
- `v3/mcp/tools/memory-tools.ts` — memory tools have no retry logic

The `MCPTool.handler` type signature in `v3/mcp/types.ts` is `(input: unknown, ctx: ToolContext) => Promise<unknown>` — no retry parameters or retry context exist.

No `RetryPolicy` interface, `RetryExecutor` class, or backoff calculation exists anywhere in the codebase. Transient failures (HTTP 429 rate limits, ETIMEDOUT network errors, temporary database locks) cause immediate task failure that propagates to the swarm as a permanent error.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/types.ts` — `MCPTool` interface
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — all agent tool handlers
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/task-tools.ts` — task tool handlers
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/memory-tools.ts` — memory tool handlers
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/index.ts` — MCP server entry point

## 2. Gap Analysis

**What's missing:**
1. No `RetryPolicy` interface — no way to configure retry behavior per tool
2. No `RetryExecutor` — no mechanism to transparently retry failed tool calls
3. No exponential backoff with jitter — retries happen at fixed intervals or not at all
4. No error classification — cannot distinguish retryable (`RATE_LIMIT`, `TIMEOUT`) from non-retryable (`VALIDATION`, `PERMISSION_DENIED`) errors
5. No `fallbackTool` support — `WebSearch` cannot automatically fall back to `WebFetch` on failure
6. No retry telemetry — cannot track retry rate or mean retries per tool call

**Concrete failure modes:**
- Anthropic API returns HTTP 429; the task fails immediately; the operator gets a cryptic error; the work is lost
- A SQLite database lock causes a memory tool call to fail; the agent doesn't retry; the swarm assumes permanent failure
- High-volume swarm runs exhaust rate limits repeatedly; without jitter, all retries fire simultaneously and amplify the rate limit pressure

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/shared/src/types/retry.ts` | `RetryPolicy`, `RetryAttempt`, `RetryContext` TypeScript interfaces |
| `v3/mcp/retry-executor.ts` | `RetryExecutor` class — wraps any tool handler with retry + backoff logic |
| `v3/mcp/error-classifier.ts` | Classifies errors as `RETRYABLE` or `NON_RETRYABLE`; maps error types |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/mcp/types.ts` | Add optional `retryPolicy` field to `MCPTool` interface |
| `v3/mcp/index.ts` | Wrap all tool handlers through `RetryExecutor` before registration |
| `v3/mcp/tools/agent-tools.ts` | Add `retryPolicy` to each tool definition |
| `v3/mcp/tools/task-tools.ts` | Add `retryPolicy` to each tool definition |
| `v3/mcp/tools/memory-tools.ts` | Add `retryPolicy` to each tool definition |
| `v3/@claude-flow/hooks/src/workers/mcp-tools.ts` | After retry exhaustion, call `DLQWriter.enqueue()` (Task 37 integration) |

## 5. Implementation Steps

**Step 1: Define shared types**

Create `v3/@claude-flow/shared/src/types/retry.ts`:

```typescript
export type RetryableErrorType =
  | 'RATE_LIMIT'      // HTTP 429
  | 'TIMEOUT'         // ETIMEDOUT, ECONNRESET, request timeout
  | 'SERVER_ERROR'    // HTTP 5xx
  | 'DB_LOCK'         // SQLite SQLITE_BUSY
  | 'NETWORK'         // General network failures

export type NonRetryableErrorType =
  | 'VALIDATION'      // Zod schema validation failure
  | 'NOT_FOUND'       // Resource does not exist
  | 'PERMISSION'      // Authorization failure
  | 'UNKNOWN'         // Catch-all for unclassified errors

export type ErrorType = RetryableErrorType | NonRetryableErrorType;

export interface RetryPolicy {
  maxAttempts: number;       // default: 3 (includes first attempt)
  initialDelayMs: number;    // default: 1000
  backoffMultiplier: number; // default: 2.0 (exponential)
  maxDelayMs: number;        // default: 30000 (cap at 30s)
  jitterMs: number;          // default: 500 (randomized ± half this value)
  retryOn: RetryableErrorType[];  // default: ['RATE_LIMIT', 'TIMEOUT', 'SERVER_ERROR']
  fallbackTool?: string;     // tool name to try after all retries exhausted
}

export const DEFAULT_RETRY_POLICY: Required<RetryPolicy> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2.0,
  maxDelayMs: 30_000,
  jitterMs: 500,
  retryOn: ['RATE_LIMIT', 'TIMEOUT', 'SERVER_ERROR'],
  fallbackTool: '',
};

export interface RetryAttempt {
  attemptNumber: number;     // 1-based
  attemptedAt: Date;
  delayMs: number;           // delay before this attempt (0 for first)
  errorType: ErrorType;
  errorMessage: string;
  latencyMs: number;
}

export interface RetryContext {
  toolName: string;
  attempts: RetryAttempt[];
  totalElapsedMs: number;
  exhausted: boolean;        // true if all attempts failed
}
```

**Step 2: Implement error classifier**

Create `v3/mcp/error-classifier.ts`:

```typescript
import type { ErrorType } from '../@claude-flow/shared/src/types/retry.js';

export function classifyError(error: Error): ErrorType {
  const msg = error.message.toLowerCase();
  const code = (error as any).code ?? '';
  const status = (error as any).status ?? (error as any).statusCode ?? 0;

  // HTTP rate limit
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'RATE_LIMIT';
  }
  // HTTP server errors
  if (status >= 500 && status < 600) return 'SERVER_ERROR';
  // Network timeouts
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED' ||
      msg.includes('timeout') || msg.includes('timed out')) {
    return 'TIMEOUT';
  }
  // Network connectivity
  if (code === 'ENOTFOUND' || msg.includes('network') || msg.includes('econnrefused')) {
    return 'NETWORK';
  }
  // SQLite lock
  if (msg.includes('sqlite_busy') || msg.includes('database is locked')) {
    return 'DB_LOCK';
  }
  // Validation errors (Zod)
  if (msg.includes('validation') || msg.includes('zod') || msg.includes('parse') ||
      msg.includes('invalid input')) {
    return 'VALIDATION';
  }
  // Not found
  if (status === 404 || msg.includes('not found')) return 'NOT_FOUND';
  // Permission
  if (status === 401 || status === 403 || msg.includes('permission') || msg.includes('forbidden')) {
    return 'PERMISSION';
  }
  return 'UNKNOWN';
}

export function isRetryable(errorType: ErrorType, policy: { retryOn: string[] }): boolean {
  return policy.retryOn.includes(errorType);
}
```

**Step 3: Implement RetryExecutor**

Create `v3/mcp/retry-executor.ts`:

```typescript
import { DEFAULT_RETRY_POLICY } from '../@claude-flow/shared/src/types/retry.js';
import { classifyError, isRetryable } from './error-classifier.js';
import type { RetryPolicy, RetryAttempt, RetryContext } from '../@claude-flow/shared/src/types/retry.js';
import type { MCPTool, ToolContext } from './types.js';

export class RetryExecutor {
  async execute(
    tool: MCPTool,
    input: unknown,
    ctx: ToolContext,
    policyOverride?: Partial<RetryPolicy>
  ): Promise<{ result: unknown; retryCtx: RetryContext }> {
    const policy = { ...DEFAULT_RETRY_POLICY, ...(tool.retryPolicy ?? {}), ...(policyOverride ?? {}) };
    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      const attemptStart = Date.now();
      const delayMs = attempt === 1 ? 0 : this.calculateDelay(attempt - 1, policy);

      if (delayMs > 0) {
        await this.sleep(delayMs);
      }

      try {
        const result = await tool.handler(input, ctx);
        const retryCtx: RetryContext = {
          toolName: tool.name,
          attempts,
          totalElapsedMs: Date.now() - startTime,
          exhausted: false,
        };
        return { result, retryCtx };
      } catch (e) {
        const error = e as Error;
        const errorType = classifyError(error);
        const latencyMs = Date.now() - attemptStart;

        attempts.push({
          attemptNumber: attempt,
          attemptedAt: new Date(attemptStart),
          delayMs,
          errorType,
          errorMessage: error.message,
          latencyMs,
        });

        ctx.logger?.warn(
          `[Retry] Tool '${tool.name}' attempt ${attempt}/${policy.maxAttempts} failed: ${errorType} — ${error.message}`
        );

        // Non-retryable error: fail immediately
        if (!isRetryable(errorType, policy)) {
          ctx.logger?.error(`[Retry] Non-retryable error for '${tool.name}': ${errorType}`);
          break;
        }

        // Final attempt
        if (attempt === policy.maxAttempts) break;
      }
    }

    // All attempts exhausted — try fallback tool if configured
    if (policy.fallbackTool) {
      const fallback = ctx.toolRegistry?.get(policy.fallbackTool);
      if (fallback) {
        ctx.logger?.info(`[Retry] Falling back to '${policy.fallbackTool}' for '${tool.name}'`);
        const result = await fallback.handler(input, ctx);
        return { result, retryCtx: { toolName: tool.name, attempts, totalElapsedMs: Date.now() - startTime, exhausted: false } };
      }
    }

    const retryCtx: RetryContext = {
      toolName: tool.name,
      attempts,
      totalElapsedMs: Date.now() - startTime,
      exhausted: true,
    };
    throw Object.assign(new Error(`All ${attempts.length} attempts failed for tool '${tool.name}'`), { retryCtx });
  }

  private calculateDelay(priorAttempts: number, policy: Required<RetryPolicy>): number {
    const base = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, priorAttempts - 1);
    const capped = Math.min(base, policy.maxDelayMs);
    const jitter = (Math.random() - 0.5) * policy.jitterMs;
    return Math.max(0, Math.round(capped + jitter));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const globalRetryExecutor = new RetryExecutor();
```

**Step 4: Add retryPolicy to tool definitions**

In `v3/mcp/tools/agent-tools.ts`:

```typescript
export const spawnAgentTool: MCPTool = {
  name: 'agent/spawn',
  // ... existing fields ...
  version: '1.2.0',
  retryPolicy: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2.0,
    jitterMs: 500,
    retryOn: ['RATE_LIMIT', 'TIMEOUT', 'SERVER_ERROR'],
  },
};
```

In `v3/mcp/tools/memory-tools.ts` (DB operations get DB_LOCK retries):

```typescript
retryPolicy: {
  maxAttempts: 5,
  initialDelayMs: 100,
  backoffMultiplier: 1.5,
  jitterMs: 50,
  retryOn: ['DB_LOCK', 'TIMEOUT'],
},
```

**Step 5: Wrap all handlers through RetryExecutor in index.ts**

In `v3/mcp/index.ts`:

```typescript
import { globalRetryExecutor } from './retry-executor.js';
import { DLQWriter } from '../@claude-flow/cli/src/dlq/dlq-writer.js';

// After building all tools:
const retryWrappedTools = globalToolRegistry.buildHandlers().map(tool => ({
  ...tool,
  handler: async (input: unknown, ctx: ToolContext) => {
    try {
      const { result, retryCtx } = await globalRetryExecutor.execute(tool, input, ctx);
      if (retryCtx.attempts.length > 0) {
        ctx.logger?.info(`[Retry] '${tool.name}' succeeded after ${retryCtx.attempts.length + 1} attempts`);
      }
      return result;
    } catch (e) {
      const err = e as Error & { retryCtx?: RetryContext };
      // Send to DLQ (Task 37) after exhaustion
      if (err.retryCtx?.exhausted) {
        const dlqWriter = new DLQWriter(ctx.db);
        await dlqWriter.enqueue({
          toolName: tool.name,
          originalPayload: input as Record<string, unknown>,
          deliveryAttempts: err.retryCtx.attempts.map(a => ({
            attemptNumber: a.attemptNumber,
            attemptedAt: a.attemptedAt.toISOString(),
            errorType: a.errorType,
            errorMessage: a.errorMessage,
            latencyMs: a.latencyMs,
          })),
          agentId: (ctx as any).agentId,
          swarmId: (ctx as any).swarmId,
        });
      }
      throw e;
    }
  },
}));
```

## 6. Key Code Templates

**RetryPolicy interface (all fields):**

```typescript
interface RetryPolicy {
  maxAttempts: number;       // default: 3
  initialDelayMs: number;    // default: 1000
  backoffMultiplier: number; // default: 2.0
  maxDelayMs: number;        // default: 30000
  jitterMs: number;          // default: 500
  retryOn: RetryableErrorType[];
  fallbackTool?: string;     // e.g. 'memory/retrieve' → fallback to 'memory/search'
}
```

**Delay calculation formula:**

```
delay(attempt) = min(initialDelayMs × backoffMultiplier^(attempt-1), maxDelayMs)
               + uniform_random(-jitterMs/2, +jitterMs/2)

Example with defaults:
  attempt 1 → 0ms (no delay before first try)
  attempt 2 → 1000ms ± 250ms
  attempt 3 → 2000ms ± 250ms
  attempt 4 → 4000ms ± 250ms  (would be attempt 4 if maxAttempts = 5)
```

**Recommended retry policies by tool category:**

| Tool category | maxAttempts | initialDelayMs | backoffMultiplier | retryOn |
|---|---|---|---|---|
| LLM API calls (agent/spawn) | 3 | 1000 | 2.0 | RATE_LIMIT, TIMEOUT, SERVER_ERROR |
| Memory/DB operations | 5 | 100 | 1.5 | DB_LOCK, TIMEOUT |
| External HTTP (WebFetch) | 3 | 2000 | 2.0 | TIMEOUT, SERVER_ERROR, NETWORK |
| Internal tools (list, status) | 2 | 500 | 1.0 | TIMEOUT |

## 7. Testing Strategy

**Unit tests** (`v3/mcp/tests/error-classifier.test.ts`):
- HTTP 429 error classifies as `RATE_LIMIT`
- `ETIMEDOUT` error classifies as `TIMEOUT`
- `SQLITE_BUSY` error classifies as `DB_LOCK`
- Zod parse error classifies as `VALIDATION`
- `VALIDATION` is not in `DEFAULT_RETRY_POLICY.retryOn`
- `RATE_LIMIT` is in `DEFAULT_RETRY_POLICY.retryOn`

**Unit tests** (`v3/mcp/tests/retry-executor.test.ts`):
- Succeeds on first attempt: `attempts.length === 0`
- Retries on `RATE_LIMIT` error: succeeds on 2nd attempt
- Stops immediately on `VALIDATION` error (non-retryable)
- Exhausts all attempts: throws error with `retryCtx.exhausted === true`
- Delay between retries is > 0 for attempts 2+
- Fallback tool is called after retry exhaustion if configured
- Jitter causes non-deterministic delay (test: run 100 times, no two identical)

**Integration tests** (`v3/mcp/tests/tool-retry-integration.test.ts`):
- `agent/spawn` with mocked HTTP 429 retries 3 times then sends to DLQ
- `memory/store` with mocked DB lock retries 5 times with shorter delays
- After retry exhaustion, DLQ entry exists in `dead_letter_queue` table

## 8. Definition of Done

- [ ] `RetryPolicy` interface and `DEFAULT_RETRY_POLICY` constant exist in shared types
- [ ] `RetryExecutor.execute()` correctly implements exponential backoff with jitter
- [ ] `classifyError()` correctly classifies all 8 error types
- [ ] All tools in `agent-tools.ts`, `task-tools.ts`, `memory-tools.ts` have `retryPolicy` defined
- [ ] `RetryExecutor` is invoked for all tool calls via `v3/mcp/index.ts` wrapper
- [ ] After retry exhaustion, `DLQWriter.enqueue()` is called (Task 37 integration)
- [ ] `VALIDATION` and `NOT_FOUND` errors are never retried
- [ ] All unit and integration tests pass
- [ ] TypeScript compiles without errors
