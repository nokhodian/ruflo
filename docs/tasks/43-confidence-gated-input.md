# Task 43: Confidence-Gated Human Input

**Priority:** Phase 4 — Advanced Features
**Effort:** Low
**Depends on:** Task 42 (Planning Step — the plan output is the natural place to emit a confidence score before requesting human input)
**Blocks:** (none)

---

## 1. Current State

Ruflo has no mechanism for agents to report a self-assessed confidence score, and no runtime checkpoint that pauses execution when confidence is low. Agents proceed unconditionally regardless of how uncertain they are about the correct action.

Relevant files:

- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` (line 152) has no `confidence_threshold` or `human_input_mode` field. `AgentInfo` interface (line 183) has no `confidence` field.
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/specialized/lsp-index-engineer.md` — no `capability.confidence_threshold` or `capability.human_input_mode` in frontmatter.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/session-hook.ts` — pre-task hook calls no confidence check.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts` — no `confidence-gate` hook or `pause-for-input` handler.
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/task-tools.ts` — task schema has no `paused_for_input` status.

---

## 2. Gap Analysis

**What is missing:**

1. No confidence score emission in agent output — agents have no prompt instruction to report a confidence score (0.0–1.0) alongside their response.
2. No `confidence_threshold` field in agent frontmatter — cannot configure per-agent pause thresholds.
3. No `human_input_mode` field — cannot configure `NEVER`, `ALWAYS`, or `ON_LOW_CONFIDENCE`.
4. No pause-and-resume mechanism — when confidence is low, there is no way to halt the agent queue and surface a prompt to the CLI session.
5. No AgentDB record for paused input requests — cannot audit which decisions triggered human review.
6. No CLI `input` command to respond to a paused agent.

**Concrete failure modes:**

- A code-deletion agent is 55% confident about which files to remove. It deletes them anyway. Recovery requires git.
- An agent generating a database migration is 40% confident about the correct rollback SQL. It produces a destructive migration.
- In non-interactive (CI) mode, low-confidence agents should either abort or take the conservative path — but currently they always proceed with the uncertain choice.
- No audit trail of "agent paused and asked human" events for compliance review.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/confidence/confidence-gate.ts` | Core `ConfidenceGate` — evaluates scores, emits pause signals |
| `v3/@claude-flow/hooks/src/confidence/confidence-prompt.ts` | System prompt segment that instructs agents to emit `CONFIDENCE: 0.XX` |
| `v3/@claude-flow/hooks/src/confidence/input-request-store.ts` | Stores pending human input requests in AgentDB with TTL |
| `v3/@claude-flow/hooks/src/confidence/types.ts` | `ConfidenceConfig`, `InputRequest`, `HumanInputMode` types |
| `v3/@claude-flow/hooks/src/confidence/index.ts` | Barrel export |
| `v3/@claude-flow/hooks/src/__tests__/confidence-gate.test.ts` | Unit tests |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `v3/mcp/tools/agent-tools.ts` | Add `confidence_threshold: z.number().min(0).max(1).default(0.7)` and `human_input_mode: z.enum(['NEVER', 'ALWAYS', 'ON_LOW_CONFIDENCE']).default('ON_LOW_CONFIDENCE')` to `spawnAgentSchema`. Add `confidence?: number` to `AgentStatus` interface. |
| `v3/@claude-flow/hooks/src/workers/session-hook.ts` | In post-task handler, call `ConfidenceGate.evaluate(agentOutput, agentConfig)`. If `PAUSE_REQUIRED`, emit `InputRequest` and suspend the agent queue. |
| `.claude/agents/specialized/lsp-index-engineer.md` | Add `capability.confidence_threshold: 0.75` and `capability.human_input_mode: ON_LOW_CONFIDENCE` to frontmatter as reference. |
| `v3/@claude-flow/cli/src/commands/hooks.ts` | Add `input respond --request-id <id> --response "<text>"` subcommand to resume a paused agent. |
| `v3/mcp/tools/task-tools.ts` | Add `'paused_for_input'` to task status enum schema. |

---

## 5. Implementation Steps

**Step 1 — Define confidence types**

Create `v3/@claude-flow/hooks/src/confidence/types.ts`:

```typescript
export type HumanInputMode = 'NEVER' | 'ALWAYS' | 'ON_LOW_CONFIDENCE';

export interface ConfidenceConfig {
  threshold: number;           // 0.0–1.0, default 0.7
  mode: HumanInputMode;
  timeoutMs: number;           // how long to wait for human input, default 120000
  ciAbortOnLowConfidence: boolean; // if true, abort task instead of pausing in CI
}

export interface InputRequest {
  requestId: string;
  agentId: string;
  taskId: string;
  agentOutput: string;
  confidenceScore: number;
  question: string;           // derived from agent output or default prompt
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'responded' | 'timed_out' | 'auto_approved';
  response?: string;
  respondedAt?: Date;
}
```

**Step 2 — Build confidence prompt**

Create `v3/@claude-flow/hooks/src/confidence/confidence-prompt.ts`. See Key Code Templates.

**Step 3 — Build confidence gate**

Create `v3/@claude-flow/hooks/src/confidence/confidence-gate.ts`. See Key Code Templates.

**Step 4 — Build input request store**

Create `v3/@claude-flow/hooks/src/confidence/input-request-store.ts`. See Key Code Templates.

**Step 5 — Wire into post-task hook**

Edit `v3/@claude-flow/hooks/src/workers/session-hook.ts`. In the post-task/post-step section:

```typescript
import { ConfidenceGate } from '../confidence/confidence-gate.js';
import { InputRequestStore } from '../confidence/input-request-store.js';

// Inside post-task/post-step handler:
const confidenceConfig = agentConfig?.capability?.confidence_threshold;
if (confidenceConfig) {
  const gateResult = await ConfidenceGate.evaluate(agentOutput, {
    threshold: confidenceConfig,
    mode: agentConfig.capability.human_input_mode ?? 'ON_LOW_CONFIDENCE',
    timeoutMs: 120_000,
    ciAbortOnLowConfidence: process.env.CI === 'true',
  });

  if (gateResult.action === 'PAUSE') {
    const request = await InputRequestStore.create(agentId, taskId, agentOutput, gateResult.score);
    // Suspend agent queue; surface request ID to CLI
    context.pauseQueue(request.requestId);
    context.emitCliPrompt(`Agent ${agentId} paused (confidence: ${gateResult.score}). Respond with:\n  npx claude-flow@v3alpha hooks input respond --request-id ${request.requestId} --response "..."`);
  }
}
```

**Step 6 — Add schema fields to agent-tools.ts**

Edit `v3/mcp/tools/agent-tools.ts`. In `spawnAgentSchema`:

```typescript
confidence_threshold: z.number().min(0).max(1).default(0.7)
  .describe('Pause for human input when agent confidence falls below this value (0.0–1.0)'),
human_input_mode: z.enum(['NEVER', 'ALWAYS', 'ON_LOW_CONFIDENCE']).default('ON_LOW_CONFIDENCE')
  .describe('When to request human input'),
```

**Step 7 — Add CLI `input respond` subcommand**

Edit `v3/@claude-flow/cli/src/commands/hooks.ts`. Add:

```typescript
.command('input respond')
.description('Respond to a paused agent waiting for human input')
.requiredOption('--request-id <id>', 'Input request ID from the paused agent')
.requiredOption('--response <text>', 'Your response to provide to the agent')
.action(async (opts) => {
  const store = new InputRequestStore();
  await store.respond(opts.requestId, opts.response);
  console.log(`Agent resumed with your input.`);
})
```

**Step 8 — Update example agent frontmatter**

Edit `.claude/agents/specialized/lsp-index-engineer.md`. In the `capability` block (added by Task 42):

```yaml
capability:
  planning_step: required
  plan_format: numbered-list
  confidence_threshold: 0.75
  human_input_mode: ON_LOW_CONFIDENCE
```

**Step 9 — Write tests**

Create `v3/@claude-flow/hooks/src/__tests__/confidence-gate.test.ts`. See Testing Strategy.

---

## 6. Key Code Templates

### `confidence-prompt.ts`

```typescript
export class ConfidencePrompt {
  /**
   * Returns a system prompt segment instructing the agent to self-report confidence.
   * Inject at the END of the system prompt so it applies to every response turn.
   */
  static inject(): string {
    return `## CONFIDENCE REPORTING

At the end of every response that involves an irreversible action (file deletion, database migration, deployment, API key rotation, etc.), you MUST append:

CONFIDENCE: 0.XX

Where 0.XX is your confidence score between 0.00 (completely uncertain) and 1.00 (completely certain).

Examples:
- CONFIDENCE: 0.95  (high confidence, proceed)
- CONFIDENCE: 0.60  (moderate uncertainty — explain why)
- CONFIDENCE: 0.30  (low confidence — stop and ask for clarification)

Do NOT omit this line for irreversible operations. It is machine-parsed.`;
  }

  /**
   * Parses a confidence score from raw agent output text.
   * Returns null if no CONFIDENCE: line is found.
   */
  static parseScore(rawOutput: string): number | null {
    const match = rawOutput.match(/CONFIDENCE:\s*(0?\.\d+|1\.0+|0|1)/i);
    if (!match) return null;
    const score = parseFloat(match[1]);
    return isNaN(score) ? null : Math.max(0, Math.min(1, score));
  }
}
```

### `confidence-gate.ts`

```typescript
import { ConfidencePrompt } from './confidence-prompt.js';
import type { ConfidenceConfig } from './types.js';

export type GateAction = 'PROCEED' | 'PAUSE' | 'ABORT';

export interface GateResult {
  action: GateAction;
  score: number | null;
  reason: string;
}

export class ConfidenceGate {
  static evaluate(rawOutput: string, config: ConfidenceConfig): GateResult {
    const score = ConfidencePrompt.parseScore(rawOutput);

    // ALWAYS mode: always pause regardless of score
    if (config.mode === 'ALWAYS') {
      return {
        action: 'PAUSE',
        score: score ?? -1,
        reason: 'human_input_mode is ALWAYS',
      };
    }

    // NEVER mode: never pause
    if (config.mode === 'NEVER') {
      return {
        action: 'PROCEED',
        score: score ?? -1,
        reason: 'human_input_mode is NEVER',
      };
    }

    // ON_LOW_CONFIDENCE: pause only when score < threshold
    if (score === null) {
      // No confidence score emitted — treat as borderline; proceed with warning
      return {
        action: 'PROCEED',
        score: null,
        reason: 'No CONFIDENCE score found in output; proceeding by default',
      };
    }

    if (score < config.threshold) {
      const isCI = process.env.CI === 'true' || process.env.CI === '1';
      if (isCI && config.ciAbortOnLowConfidence) {
        return {
          action: 'ABORT',
          score,
          reason: `CI mode: confidence ${score} < threshold ${config.threshold}; aborting task`,
        };
      }
      return {
        action: 'PAUSE',
        score,
        reason: `Confidence ${score} is below threshold ${config.threshold}`,
      };
    }

    return {
      action: 'PROCEED',
      score,
      reason: `Confidence ${score} meets threshold ${config.threshold}`,
    };
  }
}
```

### `input-request-store.ts`

```typescript
import { randomBytes } from 'crypto';
import type { InputRequest } from './types.js';

// Thin wrapper around AgentDB memory; uses the 'input-requests' namespace
export class InputRequestStore {
  private static NAMESPACE = 'input-requests';

  async create(
    agentId: string,
    taskId: string,
    agentOutput: string,
    confidenceScore: number,
    timeoutMs: number = 120_000
  ): Promise<InputRequest> {
    const requestId = `ir-${randomBytes(8).toString('hex')}`;
    const now = new Date();
    const request: InputRequest = {
      requestId,
      agentId,
      taskId,
      agentOutput,
      confidenceScore,
      question: `Agent ${agentId} has low confidence (${confidenceScore}). Please review the output above and provide guidance or approval to proceed.`,
      createdAt: now,
      expiresAt: new Date(now.getTime() + timeoutMs),
      status: 'pending',
    };

    // Persist to AgentDB via memory store (injected via hooks context in real impl)
    await this.store(requestId, request);
    return request;
  }

  async respond(requestId: string, response: string): Promise<void> {
    const request = await this.load(requestId);
    if (!request) throw new Error(`Input request not found: ${requestId}`);
    if (request.status !== 'pending') {
      throw new Error(`Input request ${requestId} is already ${request.status}`);
    }
    request.status = 'responded';
    request.response = response;
    request.respondedAt = new Date();
    await this.store(requestId, request);
  }

  async poll(requestId: string): Promise<InputRequest | null> {
    return this.load(requestId);
  }

  // Stub implementations — real implementation uses AgentDB via memory module
  private async store(key: string, value: InputRequest): Promise<void> {
    // agentdb.store(`${InputRequestStore.NAMESPACE}:${key}`, value)
    void key; void value;
  }

  private async load(key: string): Promise<InputRequest | null> {
    // return agentdb.retrieve(`${InputRequestStore.NAMESPACE}:${key}`)
    void key;
    return null;
  }
}
```

---

## 7. Testing Strategy

File: `v3/@claude-flow/hooks/src/__tests__/confidence-gate.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { ConfidencePrompt } from '../confidence/confidence-prompt.js';
import { ConfidenceGate } from '../confidence/confidence-gate.js';

describe('ConfidencePrompt.parseScore', () => {
  it('parses a mid-string confidence score', () => {
    const output = 'I will delete the files.\n\nCONFIDENCE: 0.45';
    expect(ConfidencePrompt.parseScore(output)).toBe(0.45);
  });

  it('parses a score of 1.0', () => {
    expect(ConfidencePrompt.parseScore('CONFIDENCE: 1.0')).toBe(1);
  });

  it('returns null when no CONFIDENCE line is present', () => {
    expect(ConfidencePrompt.parseScore('No score here')).toBeNull();
  });

  it('clamps scores above 1.0 to 1.0', () => {
    expect(ConfidencePrompt.parseScore('CONFIDENCE: 1.5')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(ConfidencePrompt.parseScore('confidence: 0.80')).toBe(0.8);
  });
});

describe('ConfidenceGate.evaluate', () => {
  const baseConfig = {
    threshold: 0.7,
    mode: 'ON_LOW_CONFIDENCE' as const,
    timeoutMs: 5000,
    ciAbortOnLowConfidence: false,
  };

  it('returns PROCEED when score meets threshold', () => {
    const result = ConfidenceGate.evaluate('CONFIDENCE: 0.85', baseConfig);
    expect(result.action).toBe('PROCEED');
  });

  it('returns PAUSE when score is below threshold', () => {
    const result = ConfidenceGate.evaluate('CONFIDENCE: 0.50', baseConfig);
    expect(result.action).toBe('PAUSE');
    expect(result.score).toBe(0.50);
  });

  it('returns ABORT in CI mode with ciAbortOnLowConfidence=true', () => {
    process.env.CI = 'true';
    const result = ConfidenceGate.evaluate('CONFIDENCE: 0.40', {
      ...baseConfig,
      ciAbortOnLowConfidence: true,
    });
    expect(result.action).toBe('ABORT');
    delete process.env.CI;
  });

  it('returns PROCEED when mode is NEVER regardless of score', () => {
    const result = ConfidenceGate.evaluate('CONFIDENCE: 0.10', {
      ...baseConfig,
      mode: 'NEVER',
    });
    expect(result.action).toBe('PROCEED');
  });

  it('returns PAUSE when mode is ALWAYS regardless of score', () => {
    const result = ConfidenceGate.evaluate('CONFIDENCE: 0.99', {
      ...baseConfig,
      mode: 'ALWAYS',
    });
    expect(result.action).toBe('PAUSE');
  });

  it('returns PROCEED with null score when no confidence line emitted', () => {
    const result = ConfidenceGate.evaluate('No confidence line', baseConfig);
    expect(result.action).toBe('PROCEED');
    expect(result.score).toBeNull();
  });
});
```

**Integration test:** Spawn an agent via MCP with `human_input_mode: 'ON_LOW_CONFIDENCE'` and `confidence_threshold: 0.8`. Mock the agent to output `CONFIDENCE: 0.50`. Assert that:
1. The task status transitions to `paused_for_input` in AgentDB.
2. An `InputRequest` record appears in the `input-requests` namespace.
3. Calling `hooks input respond --request-id <id> --response "proceed"` resumes the agent and transitions task status back to `active`.

---

## 8. Definition of Done

- [ ] `ConfidencePrompt.parseScore` correctly extracts confidence values from all valid formats.
- [ ] `ConfidenceGate.evaluate` returns correct action for all three `HumanInputMode` variants.
- [ ] CI abort path (`ciAbortOnLowConfidence: true`) terminates task with non-zero exit code and logs reason.
- [ ] `spawnAgentSchema` includes `confidence_threshold` and `human_input_mode` fields.
- [ ] Post-task hook evaluates confidence and calls `ConfidenceGate.evaluate` for every agent with `confidence_threshold` configured.
- [ ] `InputRequestStore.create` persists requests to AgentDB `input-requests` namespace.
- [ ] `hooks input respond` CLI subcommand resumes a paused agent.
- [ ] Task status correctly transitions to `paused_for_input` when gate returns `PAUSE`.
- [ ] `lsp-index-engineer.md` frontmatter demonstrates `confidence_threshold` and `human_input_mode`.
- [ ] All unit tests in `confidence-gate.test.ts` pass.
- [ ] TypeScript compiles with zero errors in `v3/@claude-flow/hooks`.
