# Task 02: Threshold-Gated LLM Fallback Routing

**Priority:** Phase 1 — Foundation  
**Effort:** Low  
**Depends on:** 01-semantic-route-layer  
**Blocks:** none (enhances 01)

---

## 1. Current State

After Task 01 is complete, `RouteLayer.route()` returns a `RouteResult` with `method: 'llm_fallback'` when `confidence < route.threshold`. However, Task 01's `RouteLayer` has **no implementation** for what happens when `method === 'llm_fallback'` — it simply returns the best-scoring route even if the confidence is below threshold.

Relevant files after Task 01 completes:
- **`v3/@claude-flow/routing/src/route-layer.ts`** — `route()` method sets `method: 'llm_fallback'` but does not call any LLM. Line in Step 5 of Task 01: `const method: RouteResult['method'] = best.score < best.threshold ? 'llm_fallback' : 'semantic';`
- **`v3/@claude-flow/routing/src/types.ts`** — `RouteResult.method` is typed as `'semantic' | 'keyword' | 'llm_fallback'`
- **`v3/@claude-flow/hooks/src/llm/`** — check this directory for any existing Haiku/Sonnet wrapper utilities before creating a new one
- **`v3/@claude-flow/cli/src/commands/route.ts`** — will need to be updated to handle the fallback response

The improvement plan (IMP-002) specifies: "When no route scores above its threshold, escalate to a lightweight LLM classifier that receives the task description and a compact list of all agent capabilities, then returns the best match."

---

## 2. Gap Analysis

**What is missing:**

1. **No LLM call on low confidence.** `RouteLayer` detects fallback candidates but never actually calls an LLM classifier.
2. **No `AgentCapability` compact list builder.** The LLM needs a condensed view of all available agents (slug + one-line description) to choose from. With 230+ agents, naively sending all system prompts would exceed context limits.
3. **No prompt template for the classification call.** The LLM classifier needs a structured prompt format that constrains the output to a valid agent slug.
4. **No fallback rate logging.** The improvement plan specifies that fallback rate per route should be logged. This is the observable signal for "this route needs more utterances."
5. **No `AgentCapabilityIndex`** — a pre-built compact summary of all 230+ agents that can be efficiently passed to the LLM in a single prompt without exceeding ~2000 tokens.

**Failure modes without this task:**
- Low-confidence matches silently dispatch to the wrong specialist (best-guess from Task 01 is returned without verification)
- Novel task phrasings never get a second-chance resolution
- No feedback loop for improving route utterance sets

---

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/routing/src/llm-fallback.ts` | `LLMFallbackRouter` class — builds classification prompt, calls Haiku, parses response |
| `v3/@claude-flow/routing/src/capability-index.ts` | `AgentCapabilityIndex` — compact string representation of all agents for LLM context |
| `v3/@claude-flow/routing/src/prompts/classify.ts` | Classification prompt template function |
| `tests/routing/llm-fallback.test.ts` | Unit tests with mocked LLM responses |

---

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/@claude-flow/routing/src/route-layer.ts` | Add `llmFallback?: LLMFallbackRouter` to constructor config. In `route()`, when `method === 'llm_fallback'` and `llmFallback` is set, call `llmFallback.classify(taskDescription, this.config.routes)` and use its result instead. |
| `v3/@claude-flow/routing/src/types.ts` | Add `FallbackRouteResult`, `LLMFallbackConfig`, `ClassificationPromptContext` interfaces |
| `v3/@claude-flow/routing/src/index.ts` | Export `LLMFallbackRouter`, `AgentCapabilityIndex` |
| `v3/@claude-flow/cli/src/commands/route.ts` | Log when `result.method === 'llm_fallback'` to stderr with a note about which route was nearest and why it fell below threshold |

---

## 5. Implementation Steps

### Step 1: Read existing LLM utilities

Before creating any new LLM wrapper, read:
- `v3/@claude-flow/hooks/src/llm/` directory (check if it exists and what files are there)
- `v3/@claude-flow/cli/src/commands/agent.ts` (how the CLI invokes Claude)
- `v3/@claude-flow/shared/src/` for any existing API client utilities

The goal is to reuse an existing Anthropic API client if one exists rather than creating a third.

### Step 2: Create capability index builder

Create `v3/@claude-flow/routing/src/capability-index.ts`.

The index must:
- Accept an array of `Route` objects
- Produce a compact string listing each agent slug and its description
- Stay under 2000 tokens when passed to an LLM (approx. 8000 characters)
- Format each entry as: `<slug>: <description>`

```typescript
// Full file content — see Section 6
```

### Step 3: Create the classification prompt template

Create `v3/@claude-flow/routing/src/prompts/classify.ts`.

The prompt must:
- Be a pure function with no side effects
- Accept `taskDescription: string` and `capabilityIndex: string` and return a string prompt
- Instruct the LLM to return ONLY the agent slug, nothing else
- Include a strict output format instruction
- List the top-3 semantic candidates from Task 01 as hints

```typescript
// Full file content — see Section 6
```

### Step 4: Create `LLMFallbackRouter`

Create `v3/@claude-flow/routing/src/llm-fallback.ts`.

The class must:
- Accept a configuration with the LLM caller function injected (for testability)
- Call the classification prompt
- Parse the LLM response: extract the slug via regex on `ALLOWED_AGENT_TYPES`
- Return a `RouteResult` with `method: 'llm_fallback'`
- Log the fallback event to the observability system (use `console.warn` until Task 07 implements proper cost tracking)
- Track fallback counts per route name in an in-memory Map for the session

### Step 5: Modify `RouteLayer.route()`

Read `v3/@claude-flow/routing/src/route-layer.ts` (created in Task 01).

Add the LLM fallback call:
```typescript
// In route() method, after computing `method`:
if (method === 'llm_fallback' && this.llmFallback) {
  return this.llmFallback.classify(taskDescription, this.config.routes, scores);
}
```

Add `llmFallback` to the constructor:
```typescript
constructor(config: RouteLayerConfig) {
  this.config = config;
  this.encoder = new LocalEncoder();
  if (config.llmFallback) {
    this.llmFallback = new LLMFallbackRouter(config.llmFallback);
  }
}
```

### Step 6: Update `RouteLayerConfig` in types.ts

Add:
```typescript
interface RouteLayerConfig {
  routes: Route[];
  encoder?: 'hnsw' | 'local';
  debug?: boolean;
  globalThreshold?: number;
  // NEW:
  llmFallback?: LLMFallbackConfig;
}

interface LLMFallbackConfig {
  /** Injected LLM caller for testability */
  llmCaller: (prompt: string) => Promise<string>;
  /** Model to use — should be Haiku for cost efficiency */
  model?: 'haiku' | 'sonnet';
  /** Maximum tokens to request from LLM */
  maxTokens?: number;
  /** Log fallback events to this function (defaults to console.warn) */
  onFallback?: (routeName: string, taskDescription: string, confidence: number) => void;
}
```

### Step 7: Write tests with mocked LLM

Create `tests/routing/llm-fallback.test.ts` — see Section 7.

### Step 8: Update route.ts CLI command

Read `v3/@claude-flow/cli/src/commands/route.ts`.

Add logging for fallback events:
```typescript
if (result.method === 'llm_fallback') {
  process.stderr.write(
    `[ROUTING] Low confidence (${result.confidence.toFixed(3)}) — LLM fallback invoked for route: ${result.routeName}\n`
  );
}
```

---

## 6. Key Code Templates

### `v3/@claude-flow/routing/src/capability-index.ts`
```typescript
import { Route } from './types.js';

const MAX_INDEX_CHARS = 8000;

/**
 * Build a compact text index of all agent capabilities for LLM classification.
 * Each entry: "<agentSlug>: <description>"
 * Total output stays under MAX_INDEX_CHARS to fit in a single LLM prompt.
 */
export function buildCapabilityIndex(routes: Route[]): string {
  const lines: string[] = [];
  for (const route of routes) {
    const description = route.description ?? route.utterances[0] ?? route.name;
    lines.push(`${route.agentSlug}: ${description}`);
  }

  let index = lines.join('\n');
  if (index.length > MAX_INDEX_CHARS) {
    // Truncate to fit — trim descriptions to 80 chars each
    const trimmedLines = routes.map(r => {
      const desc = (r.description ?? r.utterances[0] ?? r.name).slice(0, 80);
      return `${r.agentSlug}: ${desc}`;
    });
    index = trimmedLines.join('\n').slice(0, MAX_INDEX_CHARS);
  }
  return index;
}

/**
 * Build a compact list of the top-N candidate agents by semantic score for hint injection.
 */
export function buildCandidateHints(
  scores: Array<{ agentSlug: string; score: number }>,
  topN = 3
): string {
  return scores
    .slice(0, topN)
    .map(s => `- ${s.agentSlug} (similarity: ${s.score.toFixed(3)})`)
    .join('\n');
}
```

### `v3/@claude-flow/routing/src/prompts/classify.ts`
```typescript
/**
 * Build the classification prompt for LLM fallback routing.
 *
 * @param taskDescription - The user's task description
 * @param capabilityIndex - Pre-built compact index of all agent slugs+descriptions
 * @param candidateHints - Top-3 semantic candidates (as a formatted string)
 * @returns Prompt string to send to the LLM
 */
export function buildClassificationPrompt(
  taskDescription: string,
  capabilityIndex: string,
  candidateHints: string
): string {
  return `You are a task routing classifier. Your job is to select the single best agent slug for a given task.

## Available Agents
${capabilityIndex}

## Semantic Pre-Candidates (top 3 by embedding similarity)
${candidateHints}

## Task to Route
"${taskDescription}"

## Instructions
1. Review the task description carefully.
2. Consider the semantic pre-candidates — they may already be correct.
3. Select the SINGLE best agent slug from the Available Agents list above.
4. Output ONLY the agent slug — no explanation, no markdown, no punctuation.
5. The slug must exactly match one of the slugs in the Available Agents list.

Agent slug:`;
}
```

### `v3/@claude-flow/routing/src/llm-fallback.ts`
```typescript
import { Route, RouteResult, LLMFallbackConfig } from './types.js';
import { buildCapabilityIndex, buildCandidateHints } from './capability-index.js';
import { buildClassificationPrompt } from './prompts/classify.js';

/** Slug validation regex — must match ALLOWED_AGENT_TYPES pattern */
const SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export class LLMFallbackRouter {
  private config: LLMFallbackConfig;
  /** Session-scoped fallback counter per route name */
  private fallbackCounts = new Map<string, number>();

  constructor(config: LLMFallbackConfig) {
    this.config = config;
  }

  /**
   * Classify a task description using an LLM when semantic routing confidence is too low.
   *
   * @param taskDescription - The task to classify
   * @param routes - All registered routes (for capability index building)
   * @param scores - Semantic scores from the RouteLayer (for candidate hints)
   * @returns RouteResult with method='llm_fallback'
   */
  async classify(
    taskDescription: string,
    routes: Route[],
    scores: Array<{ routeName: string; agentSlug: string; score: number }>
  ): Promise<RouteResult> {
    const nearestRoute = scores[0];

    // Log the fallback event
    const onFallback = this.config.onFallback ?? defaultFallbackLogger;
    onFallback(nearestRoute.routeName, taskDescription, nearestRoute.score);
    this.fallbackCounts.set(
      nearestRoute.routeName,
      (this.fallbackCounts.get(nearestRoute.routeName) ?? 0) + 1
    );

    // Build prompt
    const capabilityIndex = buildCapabilityIndex(routes);
    const candidateHints = buildCandidateHints(scores);
    const prompt = buildClassificationPrompt(taskDescription, capabilityIndex, candidateHints);

    // Call LLM
    let rawResponse: string;
    try {
      rawResponse = await this.config.llmCaller(prompt);
    } catch (err) {
      // LLM unavailable — fall back to best semantic match anyway
      console.error('[LLMFallback] LLM call failed, using best semantic match:', err);
      return {
        agentSlug: nearestRoute.agentSlug,
        confidence: nearestRoute.score,
        method: 'llm_fallback',
        routeName: nearestRoute.routeName,
      };
    }

    // Parse and validate the slug
    const slug = rawResponse.trim().replace(/[`'"]/g, '').toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      console.error(`[LLMFallback] Invalid slug in LLM response: "${slug}"`);
      return {
        agentSlug: nearestRoute.agentSlug,
        confidence: nearestRoute.score,
        method: 'llm_fallback',
        routeName: nearestRoute.routeName,
      };
    }

    // Verify slug exists in routes
    const matchedRoute = routes.find(r => r.agentSlug === slug);
    if (!matchedRoute) {
      console.error(`[LLMFallback] LLM returned unknown slug: "${slug}"`);
      return {
        agentSlug: nearestRoute.agentSlug,
        confidence: nearestRoute.score,
        method: 'llm_fallback',
        routeName: nearestRoute.routeName,
      };
    }

    return {
      agentSlug: slug,
      confidence: 0.85, // LLM classification treated as high confidence
      method: 'llm_fallback',
      routeName: matchedRoute.name,
    };
  }

  /** Returns a snapshot of fallback counts for this session */
  getFallbackStats(): Record<string, number> {
    return Object.fromEntries(this.fallbackCounts.entries());
  }
}

function defaultFallbackLogger(routeName: string, task: string, confidence: number): void {
  console.warn(
    `[LLMFallback] Route "${routeName}" confidence ${confidence.toFixed(3)} below threshold for task: "${task.slice(0, 80)}..."`
  );
}
```

---

## 7. Testing Strategy

### Unit Tests (`tests/routing/llm-fallback.test.ts`)

```typescript
import { LLMFallbackRouter } from '../../v3/@claude-flow/routing/src/llm-fallback.js';
import { securityRoutes } from '../../v3/@claude-flow/routing/src/routes/security.route.js';
import { coreRoutes } from '../../v3/@claude-flow/routing/src/routes/core.route.js';

const allRoutes = [...coreRoutes, ...securityRoutes];

describe('LLMFallbackRouter', () => {
  let router: LLMFallbackRouter;

  describe('successful classification', () => {
    beforeEach(() => {
      router = new LLMFallbackRouter({
        llmCaller: async () => 'engineering-security-engineer',
      });
    });

    it('returns RouteResult with method=llm_fallback', async () => {
      const result = await router.classify(
        'check our app for injection risks',
        allRoutes,
        [{ routeName: 'coder', agentSlug: 'coder', score: 0.55 }]
      );
      expect(result.method).toBe('llm_fallback');
    });

    it('uses LLM-returned slug when it is valid', async () => {
      const result = await router.classify(
        'check our app for injection risks',
        allRoutes,
        [{ routeName: 'coder', agentSlug: 'coder', score: 0.55 }]
      );
      expect(result.agentSlug).toBe('engineering-security-engineer');
    });

    it('returns confidence 0.85 for successful LLM classification', async () => {
      const result = await router.classify(
        'any task',
        allRoutes,
        [{ routeName: 'coder', agentSlug: 'coder', score: 0.50 }]
      );
      expect(result.confidence).toBe(0.85);
    });
  });

  describe('LLM response validation', () => {
    it('falls back to best semantic match when LLM returns invalid slug', async () => {
      router = new LLMFallbackRouter({
        llmCaller: async () => 'not-a-valid-agent-!@#',
      });
      const result = await router.classify(
        'some task',
        allRoutes,
        [{ routeName: 'coder', agentSlug: 'coder', score: 0.55 }]
      );
      expect(result.agentSlug).toBe('coder'); // falls back to semantic best
    });

    it('falls back to best semantic match when LLM returns unknown slug', async () => {
      router = new LLMFallbackRouter({
        llmCaller: async () => 'completely-unknown-slug-xyz',
      });
      const result = await router.classify(
        'some task',
        allRoutes,
        [{ routeName: 'coder', agentSlug: 'coder', score: 0.55 }]
      );
      expect(result.agentSlug).toBe('coder');
    });

    it('strips markdown backticks from LLM response', async () => {
      router = new LLMFallbackRouter({
        llmCaller: async () => '`engineering-security-engineer`',
      });
      const result = await router.classify(
        'security audit task',
        allRoutes,
        [{ routeName: 'coder', agentSlug: 'coder', score: 0.45 }]
      );
      expect(result.agentSlug).toBe('engineering-security-engineer');
    });
  });

  describe('LLM failure handling', () => {
    it('returns best semantic match when LLM throws', async () => {
      router = new LLMFallbackRouter({
        llmCaller: async () => { throw new Error('Rate limited'); },
      });
      const result = await router.classify(
        'some task',
        allRoutes,
        [{ routeName: 'coder', agentSlug: 'coder', score: 0.55 }]
      );
      expect(result.agentSlug).toBe('coder');
      expect(result.method).toBe('llm_fallback');
    });
  });

  describe('fallback stats', () => {
    it('tracks fallback counts per route', async () => {
      router = new LLMFallbackRouter({
        llmCaller: async () => 'coder',
      });
      await router.classify('task 1', allRoutes, [{ routeName: 'coder', agentSlug: 'coder', score: 0.4 }]);
      await router.classify('task 2', allRoutes, [{ routeName: 'coder', agentSlug: 'coder', score: 0.4 }]);
      const stats = router.getFallbackStats();
      expect(stats['coder']).toBe(2);
    });
  });
});
```

### Integration Test with RouteLayer

```typescript
describe('RouteLayer with LLM fallback integration', () => {
  it('calls LLM fallback when confidence is below threshold', async () => {
    const llmCaller = jest.fn().mockResolvedValue('engineering-security-engineer');
    const layer = new RouteLayer({
      routes: coreRoutes.map(r => ({ ...r, threshold: 0.999 })), // force fallback
      llmFallback: { llmCaller },
    });
    const result = await layer.route('audit the JWT implementation');
    expect(llmCaller).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('llm_fallback');
  });

  it('does NOT call LLM when confidence is above threshold', async () => {
    const llmCaller = jest.fn();
    const layer = new RouteLayer({
      routes: coreRoutes.map(r => ({ ...r, threshold: 0.0 })), // always match
      llmFallback: { llmCaller },
    });
    await layer.route('implement the user registration flow');
    expect(llmCaller).not.toHaveBeenCalled();
  });
});
```

---

## 8. Definition of Done

- [ ] `LLMFallbackRouter` class exists at `v3/@claude-flow/routing/src/llm-fallback.ts`
- [ ] `RouteLayer` constructor accepts optional `llmFallback: LLMFallbackConfig`
- [ ] `RouteLayer.route()` calls `LLMFallbackRouter.classify()` when confidence < threshold
- [ ] `LLMFallbackRouter.classify()` returns `RouteResult` with `method: 'llm_fallback'`
- [ ] LLM response is validated: invalid/unknown slugs fall back to best semantic match
- [ ] LLM caller is injected via config (never hard-coded) — fully mockable in tests
- [ ] `buildClassificationPrompt` produces a prompt that constrains output to a single slug
- [ ] `buildCapabilityIndex` output is under 8000 characters for all routes
- [ ] All unit tests pass
- [ ] Integration test confirms LLM is NOT called when confidence >= threshold
- [ ] Integration test confirms LLM IS called when confidence < threshold
- [ ] `LLMFallbackRouter.getFallbackStats()` returns per-route fallback counts
- [ ] CLI `route` command prints a warning to stderr when fallback is invoked
- [ ] No TypeScript `any` types in the new files
