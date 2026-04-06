# Task 06: Structured Output Auto-Retry (Instructor Pattern)

**Priority:** Phase 1 — Foundation  
**Effort:** Low  
**Depends on:** 05-typed-io-contracts  
**Blocks:** none (enhances stability of all agent pipelines)

---

## 1. Current State

After Task 05, `SchemaValidator` and JSON Schema files exist. But there is no code that uses them to retry a failed agent call.

When an agent produces output that fails schema validation today, the pipeline throws (or silently continues with invalid data). There is no retry loop.

Relevant files after Task 05 completes:
- **`v3/@claude-flow/shared/src/schema-validator.ts`** — `SchemaValidator.validateWithJsonSchemaFile()` and `formatErrorsForReprompt()`
- **`v3/@claude-flow/shared/src/agent-contract.ts`** — `AgentContract.validateOutput()` returns `{ valid, errorMessage }`
- **`v3/mcp/tools/agent-tools.ts`** — `spawnAgentSchema` has `outputSchema` field but nothing validates against it

**What the improvement plan (IMP-012) specifies:**
```typescript
async function runAgentWithRetry<T>(
  agent: Agent,
  task: string,
  outputSchema: ZodSchema<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: ValidationError | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const raw = await agent.run(task + (lastError ? `\n\nFix these errors:\n${lastError.message}` : ''));
    const result = outputSchema.safeParse(raw);
    if (result.success) return result.data;
    lastError = result.error;
    observability.logRetry(agent.slug, attempt, lastError.message);
  }
  return { error: lastError, agentSlug: agent.slug, partialOutput: lastError } as any;
}
```

Note: The improvement plan uses Zod as the schema type. This task uses both Zod and JSON Schema (via `SchemaValidator` from Task 05) since ruflo has both patterns.

**Background worker infrastructure** at `v3/@claude-flow/hooks/src/workers/`:
- Contains `index.ts`, `mcp-tools.ts`, `session-hook.ts`, `guidance-cli.ts`
- The `BackgroundWorker` base type should be available — read `v3/@claude-flow/hooks/src/workers/index.ts` before creating files

---

## 2. Gap Analysis

**What is missing:**

1. **No `runAgentWithRetry` function.** There is no retry wrapper for agent LLM calls anywhere in the codebase.
2. **No retry loop.** Schema failures cause immediate pipeline termination.
3. **No error injection into re-prompts.** The re-prompt after a validation failure is identical to the first prompt — it does not include the specific field errors.
4. **No retry event logging.** No observability hook receives retry events (needed by Task 07 cost tracking — retries have cost implications).
5. **No graceful degradation.** After exhausting retries, the pipeline crashes rather than returning a structured error result that downstream agents can handle.
6. **`AgentErrorResult` type.** A structured error envelope for graceful degradation doesn't exist.

**Failure modes without this task:**
- A single malformed agent output (missing one required field) aborts an entire 5-agent pipeline, discarding all upstream work
- Flaky agents that occasionally miss a field are indistinguishable from deterministically broken ones
- No automatic recovery for transient LLM formatting errors

---

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/shared/src/retry-runner.ts` | `runAgentWithRetry<T>()` function — the core retry loop |
| `v3/@claude-flow/shared/src/agent-error-result.ts` | `AgentErrorResult` type — structured graceful degradation envelope |
| `v3/@claude-flow/shared/src/retry-policy.ts` | `RetryPolicy` interface + default policies |
| `tests/shared/retry-runner.test.ts` | Unit tests for the retry runner (mocked agent calls) |

---

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/@claude-flow/shared/src/schema-validator.ts` | No change needed — used as-is from Task 05 |
| `v3/@claude-flow/shared/src/index.ts` | Export `runAgentWithRetry`, `AgentErrorResult`, `RetryPolicy`, `isAgentErrorResult` |
| `v3/mcp/tools/agent-tools.ts` | In the spawn tool handler: if `outputSchema` is provided and agent produces an `output` field, validate and potentially re-run. Add `maxRetries` field to `spawnAgentSchema`. |

---

## 5. Implementation Steps

### Step 1: Create `RetryPolicy` interface and defaults

Create `v3/@claude-flow/shared/src/retry-policy.ts` — see Section 6.

Three default policies:
- `DEFAULT_RETRY_POLICY` — 3 attempts, log on each retry
- `STRICT_RETRY_POLICY` — 5 attempts, fail loudly after exhaustion  
- `LENIENT_RETRY_POLICY` — 1 attempt, graceful degradation

### Step 2: Create `AgentErrorResult` type

Create `v3/@claude-flow/shared/src/agent-error-result.ts` — see Section 6.

This is the envelope returned when all retries are exhausted. Downstream agents should check `isAgentErrorResult(result)` before processing.

### Step 3: Create `runAgentWithRetry`

Create `v3/@claude-flow/shared/src/retry-runner.ts` — see Section 6.

The function signature:
```typescript
async function runAgentWithRetry<T>(
  config: RetryRunnerConfig<T>
): Promise<T | AgentErrorResult>
```

The `RetryRunnerConfig<T>` must accept:
- `agentSlug: string` — for logging
- `agentRunner: (task: string) => Promise<unknown>` — injected runner for testability
- `task: string` — the original task prompt
- `outputSchema: ZodSchema<T> | string` — Zod schema OR path to JSON Schema file
- `policy?: RetryPolicy`
- `onRetry?: (attempt: number, errors: ValidationError[]) => void` — observability callback

### Step 4: Modify `agent-tools.ts`

Read `v3/mcp/tools/agent-tools.ts` first.

Add `maxRetries` to `spawnAgentSchema`:
```typescript
const spawnAgentSchema = z.object({
  // ...existing fields...
  maxRetries: z.number().int().min(0).max(5).default(3)
    .describe('Maximum validation retry attempts if output schema validation fails'),
});
```

In the spawn handler, after an agent completes and produces output, if `outputSchema` is set:
```typescript
if (spawnInput.outputSchema && agentOutput) {
  const validator = new SchemaValidator();
  const { valid, errorMessage } = new AgentContract().validateOutput(
    agentOutput,
    spawnInput.outputSchema
  );
  if (!valid) {
    // Log for Task 07 cost tracking hook
    console.warn(`[agent-tools] Output validation failed for ${spawnInput.agentType}: ${errorMessage}`);
  }
}
```

Note: Full retry integration in `agent-tools.ts` requires the agent runner to be synchronously callable, which may not be possible from the MCP layer. The primary integration point is the orchestrator/DAG layer (future task). For now, add the `maxRetries` field and the validation check; the full retry loop is wired in `runAgentWithRetry` for use by higher-level orchestration code.

### Step 5: Update shared exports

Read `v3/@claude-flow/shared/src/index.ts` and add:
```typescript
export { runAgentWithRetry } from './retry-runner.js';
export type { RetryRunnerConfig } from './retry-runner.js';
export { AgentErrorResult, isAgentErrorResult } from './agent-error-result.js';
export { RetryPolicy, DEFAULT_RETRY_POLICY, STRICT_RETRY_POLICY, LENIENT_RETRY_POLICY } from './retry-policy.js';
```

### Step 6: Write tests

Create `tests/shared/retry-runner.test.ts` — see Section 7.

---

## 6. Key Code Templates

### `v3/@claude-flow/shared/src/retry-policy.ts`
```typescript
export interface RetryPolicy {
  /** Maximum number of attempts (including the first attempt) */
  maxAttempts: number;
  /** Whether to append validation errors to the re-prompt */
  appendErrorsToReprompt: boolean;
  /** Whether to log each retry attempt */
  logRetries: boolean;
  /**
   * If true, return AgentErrorResult after maxAttempts instead of throwing.
   * If false, throw the last ValidationError.
   */
  gracefulDegradation: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  appendErrorsToReprompt: true,
  logRetries: true,
  gracefulDegradation: true,
};

export const STRICT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  appendErrorsToReprompt: true,
  logRetries: true,
  gracefulDegradation: false,
};

export const LENIENT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  appendErrorsToReprompt: false,
  logRetries: false,
  gracefulDegradation: true,
};
```

### `v3/@claude-flow/shared/src/agent-error-result.ts`
```typescript
import type { ValidationError } from './schema-validator.js';

/**
 * Returned by runAgentWithRetry when all retry attempts are exhausted.
 * Downstream agents should check isAgentErrorResult(result) before processing.
 */
export interface AgentErrorResult {
  /** Marker to distinguish from normal agent output */
  __agentError: true;
  agentSlug: string;
  /** Human-readable description of what failed */
  errorSummary: string;
  /** The specific validation errors from the last attempt */
  validationErrors: ValidationError[];
  /** The last raw output from the agent (before parsing failed) */
  lastRawOutput: unknown;
  /** Number of attempts made */
  attemptsExhausted: number;
  /** ISO timestamp of the failure */
  failedAt: string;
}

/**
 * Type guard: returns true if value is an AgentErrorResult.
 * Use this in downstream agents to check for upstream failures.
 */
export function isAgentErrorResult(value: unknown): value is AgentErrorResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__agentError' in value &&
    (value as AgentErrorResult).__agentError === true
  );
}

/**
 * Create an AgentErrorResult from retry exhaustion.
 */
export function createAgentErrorResult(
  agentSlug: string,
  validationErrors: ValidationError[],
  lastRawOutput: unknown,
  attemptsExhausted: number
): AgentErrorResult {
  return {
    __agentError: true,
    agentSlug,
    errorSummary: `Agent "${agentSlug}" failed schema validation after ${attemptsExhausted} attempt(s). ` +
      `Last errors: ${validationErrors.map(e => e.message).join('; ')}`,
    validationErrors,
    lastRawOutput,
    attemptsExhausted,
    failedAt: new Date().toISOString(),
  };
}
```

### `v3/@claude-flow/shared/src/retry-runner.ts`
```typescript
import type { ZodSchema } from 'zod';
import { SchemaValidator, ValidationError, ValidationResult } from './schema-validator.js';
import { AgentErrorResult, createAgentErrorResult, isAgentErrorResult } from './agent-error-result.js';
import { RetryPolicy, DEFAULT_RETRY_POLICY } from './retry-policy.js';

export interface RetryRunnerConfig<T> {
  /** Agent slug for logging */
  agentSlug: string;
  /** The initial task prompt */
  task: string;
  /**
   * The agent runner function.
   * Receives the (possibly augmented with error context) task string.
   * Returns the raw agent output (will be validated against outputSchema).
   */
  agentRunner: (task: string) => Promise<unknown>;
  /**
   * Output schema — either a Zod schema or a path to a JSON Schema file.
   */
  outputSchema: ZodSchema<T> | string;
  /** Retry policy (defaults to DEFAULT_RETRY_POLICY) */
  policy?: RetryPolicy;
  /**
   * Called after each failed attempt.
   * Use for observability (Task 07 will wire this to cost tracking).
   */
  onRetry?: (attempt: number, errors: ValidationError[], rawOutput: unknown) => void;
}

/**
 * Run an agent with automatic retry on schema validation failure.
 *
 * On each failed attempt, appends the specific validation errors to the task
 * prompt so the agent knows exactly what to fix. After maxAttempts, returns
 * either AgentErrorResult (gracefulDegradation=true) or throws.
 *
 * @example
 * const result = await runAgentWithRetry({
 *   agentSlug: 'engineering-security-engineer',
 *   task: 'Audit the auth module',
 *   agentRunner: (task) => myAgent.run(task),
 *   outputSchema: '.claude/agents/schemas/security-audit-output.json',
 * });
 * if (isAgentErrorResult(result)) {
 *   console.error('Agent failed:', result.errorSummary);
 * } else {
 *   console.log('Findings:', result.findings);
 * }
 */
export async function runAgentWithRetry<T>(
  config: RetryRunnerConfig<T>
): Promise<T | AgentErrorResult> {
  const policy = config.policy ?? DEFAULT_RETRY_POLICY;
  const validator = new SchemaValidator();

  let currentTask = config.task;
  let lastValidationErrors: ValidationError[] = [];
  let lastRawOutput: unknown = undefined;

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    // Run the agent
    let rawOutput: unknown;
    try {
      rawOutput = await config.agentRunner(currentTask);
    } catch (runError) {
      // Agent runner itself threw — not a validation error
      if (policy.gracefulDegradation) {
        return createAgentErrorResult(
          config.agentSlug,
          [{ path: '', message: `Agent runner threw: ${String(runError)}` }],
          undefined,
          attempt + 1
        );
      }
      throw runError;
    }

    lastRawOutput = rawOutput;

    // Validate the output
    let validationResult: ValidationResult;
    if (typeof config.outputSchema === 'string') {
      validationResult = validator.validateWithJsonSchemaFile(rawOutput, config.outputSchema);
    } else {
      validationResult = validator.validateWithZod(rawOutput, config.outputSchema);
    }

    if (validationResult.valid) {
      return rawOutput as T;
    }

    // Validation failed
    lastValidationErrors = validationResult.errors;

    if (policy.logRetries) {
      console.warn(
        `[RetryRunner] Attempt ${attempt + 1}/${policy.maxAttempts} failed for "${config.agentSlug}":`,
        lastValidationErrors.map(e => `${e.path}: ${e.message}`).join('; ')
      );
    }

    // Notify observability callback
    if (config.onRetry) {
      config.onRetry(attempt + 1, lastValidationErrors, rawOutput);
    }

    // Augment task with error context for next attempt
    if (policy.appendErrorsToReprompt && attempt < policy.maxAttempts - 1) {
      const errorContext = validator.formatErrorsForReprompt(lastValidationErrors);
      currentTask = `${config.task}\n\n${errorContext}`;
    }
  }

  // All attempts exhausted
  if (policy.gracefulDegradation) {
    return createAgentErrorResult(
      config.agentSlug,
      lastValidationErrors,
      lastRawOutput,
      policy.maxAttempts
    );
  }

  throw new Error(
    `Agent "${config.agentSlug}" failed validation after ${policy.maxAttempts} attempts. ` +
    `Last errors: ${lastValidationErrors.map(e => e.message).join('; ')}`
  );
}
```

---

## 7. Testing Strategy

### Unit Tests (`tests/shared/retry-runner.test.ts`)

```typescript
import { runAgentWithRetry } from '../../v3/@claude-flow/shared/src/retry-runner.js';
import { isAgentErrorResult } from '../../v3/@claude-flow/shared/src/agent-error-result.js';
import { DEFAULT_RETRY_POLICY, STRICT_RETRY_POLICY } from '../../v3/@claude-flow/shared/src/retry-policy.js';
import { z } from 'zod';

const outputSchema = z.object({
  summary: z.string(),
  count:   z.number(),
});

describe('runAgentWithRetry', () => {
  describe('successful on first attempt', () => {
    it('returns parsed output when first run succeeds', async () => {
      const runner = jest.fn().mockResolvedValue({ summary: 'ok', count: 3 });
      const result = await runAgentWithRetry({
        agentSlug: 'test-agent',
        task: 'do the thing',
        agentRunner: runner,
        outputSchema,
      });
      expect(isAgentErrorResult(result)).toBe(false);
      expect((result as { summary: string }).summary).toBe('ok');
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry on validation failure', () => {
    it('retries when output fails validation', async () => {
      const runner = jest.fn()
        .mockResolvedValueOnce({ summary: 'ok' }) // missing 'count' — fails
        .mockResolvedValueOnce({ summary: 'ok', count: 5 }); // succeeds

      const result = await runAgentWithRetry({
        agentSlug: 'test-agent',
        task: 'do the thing',
        agentRunner: runner,
        outputSchema,
      });
      expect(runner).toHaveBeenCalledTimes(2);
      expect(isAgentErrorResult(result)).toBe(false);
    });

    it('appends error context to re-prompt task', async () => {
      const runner = jest.fn()
        .mockResolvedValueOnce({ bad: 'output' })
        .mockResolvedValueOnce({ summary: 'fixed', count: 1 });

      await runAgentWithRetry({
        agentSlug: 'test-agent',
        task: 'original task',
        agentRunner: runner,
        outputSchema,
        policy: DEFAULT_RETRY_POLICY,
      });

      const secondCallTask = runner.mock.calls[1][0] as string;
      expect(secondCallTask).toContain('original task');
      expect(secondCallTask.length).toBeGreaterThan('original task'.length);
    });

    it('calls onRetry callback on each failed attempt', async () => {
      const onRetry = jest.fn();
      const runner = jest.fn()
        .mockResolvedValueOnce({ bad: 'output' })
        .mockResolvedValueOnce({ summary: 'ok', count: 1 });

      await runAgentWithRetry({
        agentSlug: 'test-agent',
        task: 'task',
        agentRunner: runner,
        outputSchema,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Array), expect.any(Object));
    });
  });

  describe('graceful degradation after max retries', () => {
    it('returns AgentErrorResult when all attempts fail (gracefulDegradation=true)', async () => {
      const runner = jest.fn().mockResolvedValue({ bad: 'output' }); // always fails

      const result = await runAgentWithRetry({
        agentSlug: 'failing-agent',
        task: 'task',
        agentRunner: runner,
        outputSchema,
        policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 },
      });

      expect(isAgentErrorResult(result)).toBe(true);
      const errorResult = result as Parameters<typeof isAgentErrorResult>[0] & { attemptsExhausted: number };
      expect((errorResult as { attemptsExhausted: number }).attemptsExhausted).toBe(2);
    });

    it('throws when all attempts fail (gracefulDegradation=false)', async () => {
      const runner = jest.fn().mockResolvedValue({ bad: 'output' });

      await expect(
        runAgentWithRetry({
          agentSlug: 'failing-agent',
          task: 'task',
          agentRunner: runner,
          outputSchema,
          policy: STRICT_RETRY_POLICY,
        })
      ).rejects.toThrow();
    });
  });

  describe('AgentErrorResult structure', () => {
    it('includes agentSlug in error result', async () => {
      const runner = jest.fn().mockResolvedValue({ bad: true });
      const result = await runAgentWithRetry({
        agentSlug: 'my-agent',
        task: 'task',
        agentRunner: runner,
        outputSchema,
        policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 },
      });
      if (isAgentErrorResult(result)) {
        expect(result.agentSlug).toBe('my-agent');
      }
    });

    it('preserves last raw output in error result', async () => {
      const lastOutput = { partial: 'data' };
      const runner = jest.fn().mockResolvedValue(lastOutput);
      const result = await runAgentWithRetry({
        agentSlug: 'my-agent',
        task: 'task',
        agentRunner: runner,
        outputSchema,
        policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 },
      });
      if (isAgentErrorResult(result)) {
        expect(result.lastRawOutput).toEqual(lastOutput);
      }
    });
  });

  describe('agent runner throws', () => {
    it('returns AgentErrorResult when runner throws (gracefulDegradation=true)', async () => {
      const runner = jest.fn().mockRejectedValue(new Error('Network error'));
      const result = await runAgentWithRetry({
        agentSlug: 'erroring-agent',
        task: 'task',
        agentRunner: runner,
        outputSchema,
      });
      expect(isAgentErrorResult(result)).toBe(true);
    });
  });

  describe('isAgentErrorResult type guard', () => {
    it('returns true for AgentErrorResult', () => {
      const err = {
        __agentError: true as const,
        agentSlug: 'x',
        errorSummary: '',
        validationErrors: [],
        lastRawOutput: null,
        attemptsExhausted: 1,
        failedAt: '',
      };
      expect(isAgentErrorResult(err)).toBe(true);
    });

    it('returns false for normal output', () => {
      expect(isAgentErrorResult({ summary: 'ok', count: 1 })).toBe(false);
      expect(isAgentErrorResult(null)).toBe(false);
      expect(isAgentErrorResult('string')).toBe(false);
    });
  });
});
```

---

## 8. Definition of Done

- [ ] `RetryPolicy` interface with 4 required fields: `maxAttempts`, `appendErrorsToReprompt`, `logRetries`, `gracefulDegradation`
- [ ] `DEFAULT_RETRY_POLICY` (3 attempts, append errors, graceful), `STRICT_RETRY_POLICY` (5 attempts, throw), `LENIENT_RETRY_POLICY` (1 attempt) exported
- [ ] `AgentErrorResult` interface with `__agentError: true` marker, `agentSlug`, `errorSummary`, `validationErrors`, `lastRawOutput`, `attemptsExhausted`, `failedAt`
- [ ] `isAgentErrorResult(value)` type guard correctly distinguishes `AgentErrorResult` from normal output
- [ ] `createAgentErrorResult()` factory function exported
- [ ] `runAgentWithRetry<T>()` accepts `RetryRunnerConfig<T>` and returns `T | AgentErrorResult`
- [ ] On validation failure: error context appended to next attempt's task string (when `appendErrorsToReprompt: true`)
- [ ] `onRetry` callback called with `(attempt, errors, rawOutput)` on each failure
- [ ] After `maxAttempts` failures with `gracefulDegradation: true`: returns `AgentErrorResult` (does not throw)
- [ ] After `maxAttempts` failures with `gracefulDegradation: false`: throws `Error`
- [ ] `agentRunner` throw with `gracefulDegradation: true` returns `AgentErrorResult` (does not propagate)
- [ ] `maxRetries` field added to `spawnAgentSchema` in `agent-tools.ts` (default: 3, max: 5)
- [ ] All unit tests pass (15+ test cases)
- [ ] Exported from `v3/@claude-flow/shared/src/index.ts`
- [ ] No TypeScript `any` types
- [ ] All files under 500 lines
