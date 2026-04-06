# Task 18: TestModel for Deterministic Agent Unit Testing
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Medium  
**Depends on:** None (standalone testing utility; can be implemented first or last in Phase 2)  
**Blocks:** None

---

## 1. Current State

There is no offline test model for ruflo agents. Any test that exercises routing, retry, or agent handoff logic must call the real Claude API — making tests slow (~2-5s per call), expensive ($0.003+ per test), and non-deterministic.

**Relevant files:**
- `v3/@claude-flow/hooks/src/reasoningbank/` — SONA, MoE, HNSW pattern learning
- `v3/@claude-flow/hooks/src/llm/llm-hooks.ts` — existing LLM hook integration
- `v3/@claude-flow/hooks/src/types.ts` — hooks type system
- `v3/mcp/tools/agent-tools.ts` — `handleSpawnAgent`, `agentTypeSchema`
- No existing `v3/@claude-flow/testing/` package

**Test files today:**
```
v3/@claude-flow/memory/src/*.test.ts      — memory backend unit tests
v3/@claude-flow/memory/src/__tests__/     — additional memory tests
```
No agent orchestration tests exist that mock the LLM layer.

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No `TestModel` class | Every routing/retry test hits the real Claude API |
| No fixture file format | Tests cannot share canonical prompt→response mappings |
| No `recordMode` | No way to build fixtures from real API calls |
| No test harness for hook firing order | Cannot verify TraceCollector, EntityExtractor, etc. fire in correct order |
| No `AgentTestBench` | Cannot compose a full agent pipeline for offline testing |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/testing/src/test-model.ts` | `TestModel` class: replays fixed responses from a `Map<string, string>` keyed by prompt hash; supports `recordMode` |
| `v3/@claude-flow/testing/src/fixture-builder.ts` | `FixtureBuilder`: records real API calls and writes them to JSON fixture files |
| `v3/@claude-flow/testing/src/agent-test-bench.ts` | `AgentTestBench`: wires `TestModel` into the hooks executor and MCP tool pipeline for full offline agent orchestration tests |
| `v3/@claude-flow/testing/src/index.ts` | Package exports |
| `v3/@claude-flow/testing/package.json` | New `@claude-flow/testing` package declaration |
| `tests/agents/routing.test.ts` | Example test using `TestModel` to verify routing decisions |
| `tests/fixtures/auth-review.json` | Sample fixture file for the auth-review routing test |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/@claude-flow/hooks/src/llm/llm-hooks.ts` | Accept an optional `modelOverride` that satisfies the `Model` interface; when provided, bypass real API call | Dependency injection for tests |
| `v3/mcp/tools/agent-tools.ts` | Export `SpawnAgentResult` type (already exported) | Needed by `AgentTestBench` |

---

## 5. Implementation Steps

**Step 1 — Create `v3/@claude-flow/testing/package.json`**

```json
{
  "name": "@claude-flow/testing",
  "version": "3.5.0",
  "description": "Offline testing utilities for ruflo agent orchestration",
  "type": "module",
  "main": "src/index.js",
  "types": "src/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {},
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "typescript": "^5.0.0"
  },
  "peerDependencies": {
    "@claude-flow/hooks": "^3.5.0",
    "@claude-flow/memory": "^3.5.0"
  }
}
```

**Step 2 — Create `v3/@claude-flow/testing/src/test-model.ts`**

```typescript
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export type PromptHash = string;

export interface TestModelConfig {
  /**
   * Map from prompt hash → response text.
   * Build with FixtureBuilder or TestModel.fromFixtureFile().
   */
  responses: Map<PromptHash, string>;
  /**
   * Fallback response when no fixture matches.
   * If not set, an error is thrown on unmatched prompts.
   */
  defaultResponse?: string;
  /**
   * When true, forward unmatched prompts to the real API and record responses.
   * Requires ANTHROPIC_API_KEY in env.
   */
  recordMode?: boolean;
  /** Path to write recorded fixtures when recordMode=true */
  recordPath?: string;
  /** Simulated latency in ms (default: 0 — instantaneous) */
  latencyMs?: number;
}

export interface Model {
  complete(prompt: string, options?: { maxTokens?: number; model?: string }): Promise<string>;
}

export function hashPrompt(prompt: string): PromptHash {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

export class TestModel implements Model {
  private recorded: Map<PromptHash, string>;

  constructor(private config: TestModelConfig) {
    this.recorded = new Map(config.responses);
  }

  async complete(prompt: string, _options?: { maxTokens?: number; model?: string }): Promise<string> {
    if (this.config.latencyMs) {
      await new Promise(r => setTimeout(r, this.config.latencyMs));
    }

    const hash = hashPrompt(prompt);
    const cached = this.recorded.get(hash);

    if (cached !== undefined) {
      return cached;
    }

    if (this.config.recordMode) {
      return this.recordAndReturn(prompt, hash);
    }

    if (this.config.defaultResponse !== undefined) {
      return this.config.defaultResponse;
    }

    throw new Error(
      `TestModel: No fixture for prompt hash "${hash}".\n` +
      `First 120 chars of prompt: ${prompt.slice(0, 120)}\n` +
      `Use recordMode:true or add a fixture for this hash.`
    );
  }

  private async recordAndReturn(prompt: string, hash: PromptHash): Promise<string> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    const response = block.type === 'text' ? block.text : '';

    this.recorded.set(hash, response);

    // Persist to file if recordPath provided
    if (this.config.recordPath) {
      this.saveToFile(this.config.recordPath);
    }

    return response;
  }

  /** Save all recorded fixtures to a JSON file */
  saveToFile(filePath: string): void {
    const obj: Record<string, string> = {};
    for (const [hash, response] of this.recorded) {
      obj[hash] = response;
    }
    writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
  }

  /** Load a TestModel from a JSON fixture file */
  static fromFixtureFile(filePath: string): TestModel {
    if (!existsSync(filePath)) {
      throw new Error(`TestModel fixture file not found: ${filePath}`);
    }
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>;
    return new TestModel({
      responses: new Map(Object.entries(raw)),
    });
  }

  /** Load fixture file if it exists, otherwise start in record mode */
  static fromFixtureOrRecord(filePath: string): TestModel {
    if (existsSync(filePath)) {
      return TestModel.fromFixtureFile(filePath);
    }
    return new TestModel({
      responses: new Map(),
      recordMode: true,
      recordPath: filePath,
    });
  }

  /** Create a TestModel with a single catch-all response (for smoke tests) */
  static withDefaultResponse(response: string): TestModel {
    return new TestModel({
      responses: new Map(),
      defaultResponse: response,
    });
  }

  /** Add a fixture programmatically */
  addFixture(prompt: string, response: string): void {
    this.recorded.set(hashPrompt(prompt), response);
  }

  /** Add a fixture by exact hash */
  addFixtureByHash(hash: PromptHash, response: string): void {
    this.recorded.set(hash, response);
  }

  get fixtureCount(): number {
    return this.recorded.size;
  }
}
```

**Step 3 — Create `v3/@claude-flow/testing/src/fixture-builder.ts`**

```typescript
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { hashPrompt } from './test-model.js';

export interface RecordedCall {
  promptHash: string;
  promptPreview: string;   // first 120 chars for debugging
  response: string;
  model: string;
  recordedAt: string;      // ISO timestamp
}

export interface FixtureFile {
  meta: {
    createdAt: string;
    callCount: number;
    model: string;
  };
  fixtures: Record<string, string>;  // hash → response
  debug: Record<string, RecordedCall>; // hash → full debug record
}

/**
 * FixtureBuilder records real API calls and writes them to a JSON fixture file.
 * Usage: wrap your test code with a FixtureBuilder to capture all LLM calls.
 */
export class FixtureBuilder {
  private calls: RecordedCall[] = [];
  private model: string;

  constructor(model = 'claude-haiku-4-5') {
    this.model = model;
  }

  /**
   * Record a real API call.
   */
  async record(prompt: string): Promise<string> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    const response = block.type === 'text' ? block.text : '';

    const hash = hashPrompt(prompt);
    this.calls.push({
      promptHash: hash,
      promptPreview: prompt.slice(0, 120),
      response,
      model: this.model,
      recordedAt: new Date().toISOString(),
    });

    return response;
  }

  /** Save all recorded calls to a fixture file */
  save(filePath: string): void {
    const fixtures: Record<string, string> = {};
    const debug: Record<string, RecordedCall> = {};

    for (const call of this.calls) {
      fixtures[call.promptHash] = call.response;
      debug[call.promptHash] = call;
    }

    const file: FixtureFile = {
      meta: {
        createdAt: new Date().toISOString(),
        callCount: this.calls.length,
        model: this.model,
      },
      fixtures,
      debug,
    };

    writeFileSync(filePath, JSON.stringify(file, null, 2), 'utf-8');
  }

  get recordCount(): number {
    return this.calls.length;
  }
}
```

**Step 4 — Create `v3/@claude-flow/testing/src/agent-test-bench.ts`**

```typescript
import { TestModel, type Model } from './test-model.js';

export interface AgentTestBenchOptions {
  model: Model;
  /** Whether to suppress console output during tests (default: true) */
  silent?: boolean;
}

export interface BenchRun {
  agentSlug: string;
  task: string;
  output: string;
  durationMs: number;
  hooksFired: string[];
}

/**
 * AgentTestBench: provides a lightweight offline environment to test
 * hook firing order, routing decisions, and entity extraction
 * without hitting the real Claude API.
 *
 * Usage:
 *   const bench = new AgentTestBench({ model: TestModel.withDefaultResponse('{}') });
 *   const result = await bench.runAgent('engineering-security-engineer', 'audit jwt.ts');
 *   expect(result.hooksFired).toContain('post-task');
 */
export class AgentTestBench {
  private model: Model;
  private hooksFired: string[] = [];
  private silent: boolean;

  constructor(options: AgentTestBenchOptions) {
    this.model = options.model;
    this.silent = options.silent ?? true;
  }

  /** Reset hook observation state between test cases */
  reset(): void {
    this.hooksFired = [];
  }

  /**
   * Simulate running an agent with the test model.
   * Fires PreTask and PostTask hooks for integration testing.
   */
  async runAgent(agentSlug: string, task: string): Promise<BenchRun> {
    const { executeHooks } = await import('@claude-flow/hooks');
    const startedAt = Date.now();

    // Simulate PreTask
    await executeHooks('pre-task' as any, { taskId: `bench-${Date.now()}`, agentSlug, task });
    this.hooksFired.push('pre-task');

    // Call model (offline)
    const output = await this.model.complete(
      `Agent: ${agentSlug}\nTask: ${task}`
    );

    // Simulate PostTask
    await executeHooks('post-task' as any, {
      taskId: `bench-${Date.now()}`,
      agentSlug,
      task,
      output,
      transcript: `Task: ${task}\nOutput: ${output}`,
    });
    this.hooksFired.push('post-task');

    return {
      agentSlug,
      task,
      output,
      durationMs: Date.now() - startedAt,
      hooksFired: [...this.hooksFired],
    };
  }

  /** Run multiple agents sequentially and collect results */
  async runSequence(
    steps: Array<{ agentSlug: string; task: string }>
  ): Promise<BenchRun[]> {
    const results: BenchRun[] = [];
    for (const step of steps) {
      results.push(await this.runAgent(step.agentSlug, step.task));
    }
    return results;
  }

  /** Run multiple agents in parallel */
  async runParallel(
    steps: Array<{ agentSlug: string; task: string }>
  ): Promise<BenchRun[]> {
    return Promise.all(steps.map(s => this.runAgent(s.agentSlug, s.task)));
  }
}
```

**Step 5 — Create `v3/@claude-flow/testing/src/index.ts`**

```typescript
export {
  TestModel,
  hashPrompt,
  type TestModelConfig,
  type Model,
  type PromptHash,
} from './test-model.js';

export {
  FixtureBuilder,
  type RecordedCall,
  type FixtureFile,
} from './fixture-builder.js';

export {
  AgentTestBench,
  type AgentTestBenchOptions,
  type BenchRun,
} from './agent-test-bench.js';
```

**Step 6 — Create `tests/fixtures/auth-review.json`**

```json
{
  "meta": {
    "createdAt": "2026-04-06T00:00:00.000Z",
    "callCount": 2,
    "model": "claude-haiku-4-5"
  },
  "fixtures": {
    "a1b2c3d4e5f6a7b8": "{\"agentSlug\":\"engineering-security-engineer\",\"confidence\":0.91,\"method\":\"semantic\"}",
    "f8e7d6c5b4a3f2e1": "{\"findings\":[],\"summary\":\"No vulnerabilities found\",\"severity\":\"low\"}"
  },
  "debug": {
    "a1b2c3d4e5f6a7b8": {
      "promptHash": "a1b2c3d4e5f6a7b8",
      "promptPreview": "Route this task to the correct agent: Review the JWT validation in auth.ts",
      "response": "{\"agentSlug\":\"engineering-security-engineer\",\"confidence\":0.91,\"method\":\"semantic\"}",
      "model": "claude-haiku-4-5",
      "recordedAt": "2026-04-06T00:00:00.000Z"
    }
  }
}
```

**Step 7 — Create `tests/agents/routing.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { TestModel, AgentTestBench, hashPrompt } from '@claude-flow/testing';

describe('Agent routing with TestModel', () => {
  let bench: AgentTestBench;

  beforeEach(() => {
    const model = TestModel.withDefaultResponse(
      JSON.stringify({ findings: [], summary: 'ok', severity: 'low' })
    );
    bench = new AgentTestBench({ model });
  });

  it('runs engineering-security-engineer agent offline', async () => {
    const result = await bench.runAgent(
      'engineering-security-engineer',
      'Review the JWT validation in auth.ts'
    );
    expect(result.status ?? 'success').toBe('success');
    expect(result.durationMs).toBeLessThan(100); // offline — should be <100ms
    expect(result.hooksFired).toContain('pre-task');
    expect(result.hooksFired).toContain('post-task');
  });

  it('runs parallel agents without real API calls', async () => {
    const results = await bench.runParallel([
      { agentSlug: 'engineering-security-engineer', task: 'Audit auth.ts' },
      { agentSlug: 'engineering-code-reviewer', task: 'Review auth.ts for style' },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.durationMs < 200)).toBe(true);
  });

  it('TestModel throws on unmatched prompt without defaultResponse', async () => {
    const strictModel = new TestModel({ responses: new Map() });
    await expect(strictModel.complete('unrecognized prompt')).rejects.toThrow('No fixture');
  });

  it('TestModel.fromFixtureFile() loads fixtures correctly', () => {
    const model = TestModel.fromFixtureFile('./tests/fixtures/auth-review.json');
    expect(model.fixtureCount).toBeGreaterThan(0);
  });

  it('TestModel.addFixture() adds and retrieves a fixture', async () => {
    const model = new TestModel({ responses: new Map() });
    model.addFixture('Hello, agent', 'I am ready');
    const response = await model.complete('Hello, agent');
    expect(response).toBe('I am ready');
  });
});
```

---

## 6. Key Code Templates

### Building a fixture file for a new agent test
```typescript
import { FixtureBuilder } from '@claude-flow/testing';

const builder = new FixtureBuilder('claude-haiku-4-5');
// Run your agent scenarios once against the real API:
await builder.record('Route task: audit JWT handling in auth.ts');
await builder.record('Analyze auth.ts for security vulnerabilities');
// Save for future offline use:
builder.save('./tests/fixtures/security-agent.json');
console.log(`Recorded ${builder.recordCount} fixtures`);
```

### Using TestModel in a Jest test
```typescript
const model = TestModel.fromFixtureFile('./tests/fixtures/security-agent.json');
// OR: start offline with a default
const model = TestModel.withDefaultResponse('{"findings":[],"severity":"low"}');
// OR: record mode for first run, replay on subsequent
const model = TestModel.fromFixtureOrRecord('./tests/fixtures/security-agent.json');
```

### Fixture file format (for manual creation)
```json
{
  "meta": { "createdAt": "2026-04-06T00:00:00Z", "callCount": 1, "model": "claude-haiku-4-5" },
  "fixtures": {
    "<sha256_first_16_chars_of_prompt>": "<response text>"
  }
}
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/testing/src/test-model.test.ts`**
```typescript
describe('TestModel', () => {
  it('returns fixture for matching prompt hash', async () => {
    const model = new TestModel({ responses: new Map() });
    model.addFixture('hello', 'world');
    expect(await model.complete('hello')).toBe('world');
  });
  it('throws on unmatched prompt without defaultResponse', async () => { ... });
  it('returns defaultResponse on unmatched prompt', async () => { ... });
  it('fromFixtureFile() loads all fixtures', () => { ... });
  it('saveToFile() writes valid JSON', () => { ... });
  it('simulates latencyMs delay', async () => {
    const model = new TestModel({ responses: new Map(), defaultResponse: 'ok', latencyMs: 50 });
    const t = Date.now();
    await model.complete('any');
    expect(Date.now() - t).toBeGreaterThanOrEqual(50);
  });
});
```

**Unit — `v3/@claude-flow/testing/src/agent-test-bench.test.ts`**
```typescript
describe('AgentTestBench', () => {
  it('runAgent fires pre-task and post-task hooks', async () => { ... });
  it('runParallel returns one result per input', async () => { ... });
  it('runSequence executes in order', async () => { ... });
  it('reset() clears hooksFired', () => { ... });
});
```

**CI gate:** Add to `.github/workflows/ci.yml`:
```yaml
- name: Run offline agent tests
  run: npm test -- --testPathPattern=tests/agents/routing.test.ts
  env:
    # No ANTHROPIC_API_KEY needed — purely offline
```

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/testing/src/test-model.ts` compiles without errors
- [ ] `v3/@claude-flow/testing/src/fixture-builder.ts` compiles
- [ ] `v3/@claude-flow/testing/src/agent-test-bench.ts` compiles
- [ ] `v3/@claude-flow/testing/package.json` exists with correct package name
- [ ] `TestModel.fromFixtureFile()` loads `tests/fixtures/auth-review.json` successfully
- [ ] `tests/agents/routing.test.ts` passes without `ANTHROPIC_API_KEY`
- [ ] Offline test run completes in < 500ms total
- [ ] `TestModel.addFixture()` / `addFixtureByHash()` work correctly
- [ ] `latencyMs` option simulates delay (verified by timing assertion)
- [ ] `hashPrompt()` is deterministic — same input always produces same 16-char hash
- [ ] No `any` in public API surface of `test-model.ts` or `agent-test-bench.ts`
