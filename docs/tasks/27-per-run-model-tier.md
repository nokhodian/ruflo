# Task 27: Per-Run Model Tier Selection
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** Low  
**Depends on:** none (extends existing 3-tier routing from ADR-026 in CLAUDE.md)  
**Blocks:** none

## 1. Current State

Model tier selection is documented in CLAUDE.md but applied only to the Claude Code harness itself — it is not propagated to the 230+ sub-agents that the system spawns.

| Component | Location | Current Behavior |
|---|---|---|
| 3-tier routing | `CLAUDE.md` — "3-Tier Model Routing (ADR-026)" | Documented as Tier 1 (WASM), Tier 2 (Haiku), Tier 3 (Sonnet/Opus) |
| Agent spawn | `v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` | No `model` field; model is not passed to spawned agents |
| Agent frontmatter | `.claude/agents/**/*.md` | No `model_preference` field today |
| Complexity scoring | No implementation | No programmatic way to assess task complexity |
| Cost enforcement | No implementation | No `max_cost_usd` cap per agent call |
| Model override | No implementation | No mechanism for orchestrator to inject model tier at dispatch time |

**Concrete failure mode 1 (over-provisioning):** A `marketing-seo-specialist` agent is asked to format a list of 10 keywords alphabetically. It runs on `claude-sonnet` (Tier 3), costing ~$0.003 for what Haiku could do for ~$0.0002. Multiplied across 50 agents per hour, this is a $7.30/hour overcharge.

**Concrete failure mode 2 (under-provisioning):** A `engineering-software-architect` agent is asked to design a distributed caching layer. It runs on Haiku because no override exists. The low-capability model produces a shallow design that requires a second expensive Sonnet run to fix.

## 2. Gap Analysis

- No `model_preference` block in agent frontmatter — no per-agent model declaration.
- No `model_settings` in `spawnAgentSchema` — orchestrator cannot override at dispatch time.
- No complexity scorer — nothing converts a task description into a 0–100 complexity score.
- No `max_cost_usd` enforcement — agents can spend without limit per call.
- No `extended_thinking: true` flag on architect/security agents that need it.
- No telemetry on model tier used per task (needed to measure cost savings after implementing this).

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/cli/src/model/complexity-scorer.ts` | Scores task complexity 0–100 based on token heuristics and keyword detection |
| `v3/@claude-flow/cli/src/model/model-tier-resolver.ts` | Resolves the correct model tier from task complexity + agent `model_preference` |
| `v3/@claude-flow/cli/src/model/model-settings.ts` | `ModelSettings` type and per-tier default configurations |
| `tests/model/model-tier-resolver.test.ts` | Unit tests for resolution logic covering all override paths |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/mcp/tools/agent-tools.ts` | Add `model_settings?: ModelSettingsSchema` to `spawnAgentSchema`; in spawn handler, resolve final model from `ModelTierResolver.resolve(agentSlug, taskDescription, model_settings)` | Exposes per-spawn model control at the MCP boundary |
| All 230+ agent `.md` files (frontmatter) | Add `model_preference` block to `capability` section (see template below) | Declares per-agent default model tier |
| `v3/@claude-flow/hooks/src/hooks/post-task.ts` | Record `model` used in task result alongside token counts | Enables cost attribution per model tier |

## 5. Implementation Steps

1. **Define `ModelSettings` types** — In `model-settings.ts`, define the full type, the three tier configurations, and the `ModelPreference` interface for frontmatter declarations.

2. **Build `ComplexityScorer`** — In `complexity-scorer.ts`, implement `score(taskDescription: string): number` (returns 0–100):
   - Token count heuristic: longer task descriptions indicate more complex tasks.
   - Keyword scoring: high-complexity keywords (`architecture`, `design`, `distributed`, `security audit`, `CVE`) add points; low-complexity keywords (`format`, `list`, `rename`, `alphabetical`) subtract points.
   - Agent type adjustment: some agent types (`engineering-software-architect`, `engineering-security-engineer`) receive a +20 bonus to ensure they get adequate model resources.
   - Return score clamped to [0, 100].

3. **Build `ModelTierResolver`** — In `model-tier-resolver.ts`, implement `resolve(agentSlug, taskDescription, overrideSettings?)`:
   - If `overrideSettings?.model` is explicitly set, use it (orchestrator override).
   - Otherwise, score complexity.
   - If score < 30 AND agent `model_preference.default != 'opus'`: use `haiku`, `max_tokens: 2048`.
   - If score >= 70 OR agent type is in `HIGH_COMPLEXITY_AGENTS`: use `opus`, `extended_thinking: true`.
   - Otherwise: use `sonnet`.
   - If `overrideSettings?.max_cost_usd` is set, record it for enforcement.

4. **Update spawn schema** — In `agent-tools.ts`, add `model_settings` as an optional Zod object with `model`, `max_tokens`, `max_cost_usd`, `extended_thinking`, `temperature` fields.

5. **Wire into spawn handler** — After resolving agent slug and system prompt, call `ModelTierResolver.resolve()` and include the result in the spawn metadata as `model_settings_resolved`.

6. **Update `post-task` hook** — Record the `model` used (from resolved settings) in the task result.

7. **Write tests** — Cover: simple task → haiku, complex task → opus, explicit override → override wins, `max_cost_usd` recorded, architect agent always gets sonnet/opus minimum.

## 6. Key Code Templates

```typescript
// v3/@claude-flow/cli/src/model/model-settings.ts

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ModelSettings {
  model:             ModelTier;
  maxTokens?:        number;
  maxCostUsd?:       number;    // per-call budget cap
  extendedThinking?: boolean;
  temperature?:      number;    // 0.0–1.0
}

export interface ModelPreference {
  default:          ModelTier;       // 'haiku' | 'sonnet' | 'opus'
  maxCostUsd?:      number;          // auto-downgrade if projected cost would exceed this
  extendedThinking?: boolean;        // enable for complex reasoning tasks
}

export const TIER_DEFAULTS: Record<ModelTier, ModelSettings> = {
  haiku: {
    model:             'haiku',
    maxTokens:         2048,
    extendedThinking:  false,
    temperature:       0.3,
  },
  sonnet: {
    model:             'sonnet',
    maxTokens:         8192,
    extendedThinking:  false,
    temperature:       0.5,
  },
  opus: {
    model:             'opus',
    maxTokens:         16384,
    extendedThinking:  true,
    temperature:       0.7,
  },
};

// Claude model IDs
export const MODEL_IDS: Record<ModelTier, string> = {
  haiku:  'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-5',
  opus:   'claude-opus-4-5',
};
```

```typescript
// v3/@claude-flow/cli/src/model/complexity-scorer.ts

const HIGH_COMPLEXITY_KEYWORDS = [
  'architecture', 'architect', 'design', 'distributed', 'scalab',
  'security audit', 'threat model', 'CVE', 'vulnerability assessment',
  'schema design', 'database design', 'API design', 'system design',
  'refactor entire', 'migrate all', 'performance optimization',
];

const LOW_COMPLEXITY_KEYWORDS = [
  'format', 'alphabetical', 'list', 'rename', 'capitalize', 'sort',
  'simple fix', 'typo', 'comment', 'indent', 'whitespace',
];

// Agent types that always warrant at least Sonnet
export const HIGH_COMPLEXITY_AGENTS = new Set([
  'engineering-software-architect', 'engineering-security-engineer',
  'engineering-backend-architect', 'security-architect', 'system-architect',
  'engineering-solidity-smart-contract-engineer', 'byzantine-coordinator',
  'hierarchical-coordinator', 'consensus-builder',
]);

export function scoreComplexity(taskDescription: string, agentSlug?: string): number {
  let score = 50; // baseline

  // Token count heuristic: <20 words → simple; >100 words → complex
  const wordCount = taskDescription.trim().split(/\s+/).length;
  if (wordCount < 20)  score -= 20;
  if (wordCount > 100) score += 20;
  if (wordCount > 200) score += 10;

  // Keyword scoring
  const lower = taskDescription.toLowerCase();
  for (const kw of HIGH_COMPLEXITY_KEYWORDS) {
    if (lower.includes(kw)) { score += 10; break; }
  }
  for (const kw of LOW_COMPLEXITY_KEYWORDS) {
    if (lower.includes(kw)) { score -= 10; break; }
  }

  // Multi-step indicator
  const stepIndicators = /step \d|first.*then|follow.*by|requirement|constraint|ensure that/i;
  if (stepIndicators.test(taskDescription)) score += 10;

  // Code block or file reference → more complex
  if (/```|\.ts\b|\.py\b|\.go\b|src\/|tests\//.test(taskDescription)) score += 5;

  // Agent type bonus
  if (agentSlug && HIGH_COMPLEXITY_AGENTS.has(agentSlug)) score += 20;

  return Math.max(0, Math.min(100, score));
}
```

```typescript
// v3/@claude-flow/cli/src/model/model-tier-resolver.ts
import { ModelSettings, ModelTier, TIER_DEFAULTS, ModelPreference } from './model-settings.js';
import { scoreComplexity, HIGH_COMPLEXITY_AGENTS } from './complexity-scorer.js';

export interface ResolvedModelSettings extends ModelSettings {
  complexityScore: number;
  resolutionReason: string;
}

export function resolveModelTier(
  agentSlug: string,
  taskDescription: string,
  agentPreference?: ModelPreference,
  orchestratorOverride?: Partial<ModelSettings>
): ResolvedModelSettings {
  // Orchestrator override wins
  if (orchestratorOverride?.model) {
    return {
      ...TIER_DEFAULTS[orchestratorOverride.model],
      ...orchestratorOverride,
      complexityScore: -1,
      resolutionReason: 'orchestrator_override',
    };
  }

  const score = scoreComplexity(taskDescription, agentSlug);

  let tier: ModelTier;
  let reason: string;

  if (score < 30 && agentPreference?.default !== 'opus') {
    tier = 'haiku';
    reason = `complexity_score=${score} (<30) → haiku`;
  } else if (score >= 70 || HIGH_COMPLEXITY_AGENTS.has(agentSlug)) {
    tier = 'opus';
    reason = `complexity_score=${score} (>=70) or high-complexity agent → opus`;
  } else {
    tier = agentPreference?.default ?? 'sonnet';
    reason = `complexity_score=${score} → ${tier} (from preference or default)`;
  }

  const base = { ...TIER_DEFAULTS[tier] };

  // Apply agent preference overrides
  if (agentPreference?.maxCostUsd) base.maxCostUsd = agentPreference.maxCostUsd;
  if (agentPreference?.extendedThinking !== undefined) base.extendedThinking = agentPreference.extendedThinking;

  return {
    ...base,
    complexityScore: score,
    resolutionReason: reason,
  };
}
```

```typescript
// Extension to v3/mcp/tools/agent-tools.ts — model_settings schema addition

const modelSettingsSchema = z.object({
  model:             z.enum(['haiku', 'sonnet', 'opus']).optional(),
  maxTokens:         z.number().int().min(1).max(32768).optional(),
  maxCostUsd:        z.number().min(0).max(10).optional(),
  extendedThinking:  z.boolean().optional(),
  temperature:       z.number().min(0).max(1).optional(),
});

// Add to spawnAgentSchema:
// model_settings: modelSettingsSchema.optional().describe('Override model tier for this spawn')
```

### Agent Frontmatter Example

```yaml
---
name: Software Architect
version: "1.0.0"
description: Designs system architecture, API contracts, and scalable infrastructure.
tools: Read, Write, Glob, Grep, WebSearch, WebFetch
capability:
  role: software-architect
  goal: Design robust, scalable system architectures
  task_types:
    - architecture
    - system-design
    - api-design
  model_preference:
    default: opus           # always use best model for architecture work
    max_cost_usd: 0.15      # per-call budget cap
    extended_thinking: true # enable chain-of-thought for design tasks
---
```

```yaml
---
name: SEO Specialist
version: "1.0.0"
description: Optimizes content for search engines.
tools: Read, WebSearch
capability:
  role: marketing-seo
  task_types:
    - keyword-research
    - content-optimization
  model_preference:
    default: haiku          # SEO tasks are primarily formatting/categorization
    max_cost_usd: 0.01
    extended_thinking: false
---
```

### CLI Usage

```bash
# Spawn with explicit model override
npx claude-flow@v3alpha agent spawn -t engineering-software-architect \
  --model-settings '{"model": "opus", "extendedThinking": true}'

# Spawn with cost cap
npx claude-flow@v3alpha agent spawn -t marketing-content-creator \
  --model-settings '{"maxCostUsd": 0.005}'

# View resolved model settings for a task (dry run)
npx claude-flow@v3alpha agent spawn -t coder --task "sort this list" --dry-run-model-resolution
# Output: complexity_score=22, resolved=haiku, reason=complexity_score=22 (<30) → haiku
```

## 7. Testing Strategy

```typescript
// tests/model/model-tier-resolver.test.ts
import { resolveModelTier } from '../../v3/@claude-flow/cli/src/model/model-tier-resolver.js';
import { scoreComplexity } from '../../v3/@claude-flow/cli/src/model/complexity-scorer.js';

describe('scoreComplexity()', () => {
  it('scores simple formatting tasks below 30', () => {
    expect(scoreComplexity('Format this list alphabetically')).toBeLessThan(30);
  });

  it('scores architecture tasks above 70', () => {
    expect(scoreComplexity('Design a distributed caching architecture for 10,000 concurrent users with Redis and fallback strategies')).toBeGreaterThan(70);
  });

  it('gives high-complexity agent types a +20 bonus', () => {
    const withBonus = scoreComplexity('simple task', 'engineering-software-architect');
    const withoutBonus = scoreComplexity('simple task');
    expect(withBonus).toBeGreaterThan(withoutBonus);
    expect(withBonus - withoutBonus).toBe(20);
  });
});

describe('resolveModelTier()', () => {
  it('returns haiku for simple tasks', () => {
    const result = resolveModelTier('coder', 'format a list');
    expect(result.model).toBe('haiku');
    expect(result.resolutionReason).toContain('haiku');
  });

  it('returns opus for complex tasks', () => {
    const result = resolveModelTier(
      'engineering-software-architect',
      'Design a distributed event-sourcing architecture with CQRS and saga pattern'
    );
    expect(result.model).toBe('opus');
  });

  it('orchestrator override wins over everything', () => {
    const result = resolveModelTier(
      'coder', 'simple task',
      { default: 'haiku' },
      { model: 'opus' }
    );
    expect(result.model).toBe('opus');
    expect(result.resolutionReason).toBe('orchestrator_override');
  });

  it('respects agent preference default over sonnet fallback', () => {
    const result = resolveModelTier('marketing-seo-specialist', 'Write a meta description', { default: 'haiku' });
    // Score should be medium (~50), agent preference says haiku → haiku
    expect(result.model).toBe('haiku');
  });

  it('never uses haiku for opus-declared agents even on simple tasks', () => {
    const result = resolveModelTier('engineering-software-architect', 'rename a variable');
    // High complexity agent gets +20 bonus, should still hit sonnet/opus range
    expect(['sonnet', 'opus']).toContain(result.model);
  });

  it('records max_cost_usd from agent preference', () => {
    const result = resolveModelTier('coder', 'design an API', { default: 'sonnet', maxCostUsd: 0.05 });
    expect(result.maxCostUsd).toBe(0.05);
  });
});
```

## 8. Definition of Done

- [ ] `ModelSettings`, `ModelPreference`, `TIER_DEFAULTS` types defined and compile with `tsc --strict`
- [ ] `scoreComplexity()` returns < 30 for simple formatting tasks, > 70 for architecture/security tasks
- [ ] `HIGH_COMPLEXITY_AGENTS` list includes architect, security engineer, and other high-demand types
- [ ] `resolveModelTier()` returns haiku for score < 30 (when agent default is not opus)
- [ ] `resolveModelTier()` returns opus for score >= 70 or high-complexity agent types
- [ ] Orchestrator override (`model_settings.model`) wins over all other logic
- [ ] `max_cost_usd` from agent preference is propagated to resolved settings
- [ ] `model_settings` optional field added to `spawnAgentSchema` in `agent-tools.ts`
- [ ] Spawn handler calls `resolveModelTier()` and stores resolved settings in agent metadata
- [ ] `post-task` hook records the resolved `model` in task result
- [ ] At least 5 representative agent `.md` files updated with `model_preference` block (architect, security engineer, seo specialist, coder, marketing content creator)
- [ ] All unit tests pass; `tsc --noEmit` passes
