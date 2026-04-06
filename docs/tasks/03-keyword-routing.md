# Task 03: Hybrid Semantic + Keyword Routing (Keyword Pre-Filter)

**Priority:** Phase 1 — Foundation  
**Effort:** Low  
**Depends on:** 01-semantic-route-layer  
**Blocks:** none (enhances 01)

---

## 1. Current State

After Task 01, routing is purely semantic (embedding cosine similarity). Tasks containing unambiguous high-signal domain tokens like `CVE-2024-12345`, `Dockerfile`, or `pytest` are routed through the full embedding pipeline even though the correct agent is deterministic from the token alone.

Relevant files after Task 01 completes:
- **`v3/@claude-flow/routing/src/route-layer.ts`** — `route()` method immediately encodes the task description and computes cosine similarity. There is no pre-filter step.
- **`v3/@claude-flow/routing/src/types.ts`** — `RouteResult.method` already has `'keyword'` as a valid value (defined in Task 01), but no code path produces it yet.

The improvement plan (IMP-003) specifies: "Keyword regex pre-filter runs before RouteLayer. On match, short-circuits to the correct agent with `confidence=1.0`. RouteLayer handles everything else."

---

## 2. Gap Analysis

**What is missing:**

1. **No keyword pre-filter file.** `v3/@claude-flow/routing/src/keyword-pre-filter.ts` was listed in Task 01 as a file to create but was deferred. Task 01 implements the semantic layer only.
2. **No regex rule set.** No file contains the `KEYWORD_ROUTES` array from the improvement plan.
3. **`RouteLayer.route()` has no pre-filter hook.** The method jumps directly to embedding and cosine scoring.
4. **No way to extend keyword rules.** There is no API to add new keyword rules without modifying the source file.

**Why keyword pre-filter before semantic routing:**

- **Speed:** Regex match is ~0.1ms vs. embedding + cosine at ~5–50ms. For tasks with unambiguous tokens, the embedding step is pure overhead.
- **Precision:** Embeddings produce probabilistic similarities. A task containing `CVE-2024-1234` has a deterministic correct agent (`engineering-security-engineer`) — probabilistic scoring is inappropriate.
- **Token economy:** Avoids encoding tasks that are trivially classifiable.

**Failure modes without this task:**
- Tasks mentioning `Dockerfile` may embed-route to `coder` or `researcher` instead of `engineering-devops-automator`
- CVE tasks may route incorrectly if the embedding space doesn't cleanly separate CVE-description language
- Routing latency is higher than necessary for deterministic cases

---

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/routing/src/keyword-pre-filter.ts` | `KeywordPreFilter` class with KEYWORD_ROUTES array and `match()` method |
| `tests/routing/keyword-pre-filter.test.ts` | Unit tests for all keyword rules |

---

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/@claude-flow/routing/src/route-layer.ts` | At the start of `route()`, call `this.keywordFilter.match(taskDescription)`. If it returns a result, return immediately with `method: 'keyword'`, skip encoding. |
| `v3/@claude-flow/routing/src/types.ts` | Add `KeywordRule` interface and `KeywordPreFilterConfig` interface |
| `v3/@claude-flow/routing/src/index.ts` | Export `KeywordPreFilter`, `KeywordRule` |

---

## 5. Implementation Steps

### Step 1: Define the keyword rules and create `keyword-pre-filter.ts`

Read `v3/@claude-flow/routing/src/types.ts` to ensure the `KeywordRule` interface is added there (or add it inline in the pre-filter file if simpler).

Create `v3/@claude-flow/routing/src/keyword-pre-filter.ts` — full implementation in Section 6.

The file must contain:
1. `KeywordRule` type (pattern, agentSlug, routeName, description)
2. `DEFAULT_KEYWORD_ROUTES` array with all the rules from the improvement plan plus extensions
3. `KeywordPreFilter` class with `match(taskDescription: string): RouteResult | null` method
4. `addRule(rule: KeywordRule): void` method for runtime extension

### Step 2: Expand the DEFAULT_KEYWORD_ROUTES array

The improvement plan provides this initial set:
```typescript
const KEYWORD_ROUTES = [
  { pattern: /\.(test|spec)\.[tj]s/i,        agentSlug: 'tdd-london-swarm' },
  { pattern: /Dockerfile|docker-compose/i,    agentSlug: 'engineering-devops-automator' },
  { pattern: /CVE-\d{4}-\d+/i,               agentSlug: 'engineering-security-engineer' },
  { pattern: /git (blame|log|rebase)/i,       agentSlug: 'engineering-git-workflow-master' },
  { pattern: /\.sol\b|solidity/i,             agentSlug: 'engineering-solidity-smart-contract-engineer' },
  { pattern: /lsp|language.server/i,          agentSlug: 'lsp-index-engineer' },
];
```

Expand this to 30+ rules covering all major agent categories. See the full list in Section 6.

### Step 3: Modify `RouteLayer.route()`

Read `v3/@claude-flow/routing/src/route-layer.ts`.

Add at the start of the `route()` method (before `await this.initialize()`):
```typescript
// Keyword pre-filter: O(n_rules) regex checks, short-circuit on match
if (this.keywordFilter) {
  const keywordResult = this.keywordFilter.match(taskDescription);
  if (keywordResult) return keywordResult;
}
```

Add `keywordFilter` to the constructor:
```typescript
if (config.enableKeywordFilter !== false) {
  this.keywordFilter = new KeywordPreFilter(config.keywordRules);
}
```

Add `enableKeywordFilter?: boolean` and `keywordRules?: KeywordRule[]` to `RouteLayerConfig` in `types.ts`.

### Step 4: Write unit tests

Create `tests/routing/keyword-pre-filter.test.ts` — see Section 7.

### Step 5: Update barrel exports

Read `v3/@claude-flow/routing/src/index.ts` and add exports for `KeywordPreFilter` and `KeywordRule`.

---

## 6. Key Code Templates

### `v3/@claude-flow/routing/src/keyword-pre-filter.ts`
```typescript
import { RouteResult } from './types.js';

export interface KeywordRule {
  /** Regex pattern to test against the task description */
  pattern: RegExp;
  /** Agent slug from ALLOWED_AGENT_TYPES */
  agentSlug: string;
  /** Route name for RouteResult.routeName */
  routeName: string;
  /** Human-readable description of why this rule exists */
  description: string;
}

/**
 * Default keyword rules derived from the improvement plan (IMP-003).
 * Rules are tested in order — FIRST MATCH wins.
 * More specific rules should appear before more general ones.
 */
export const DEFAULT_KEYWORD_ROUTES: KeywordRule[] = [
  // ---- Unambiguous file/tool references ----
  {
    pattern: /CVE-\d{4}-\d+/i,
    agentSlug: 'engineering-security-engineer',
    routeName: 'security-engineer',
    description: 'CVE identifier — deterministic security routing',
  },
  {
    pattern: /\.(test|spec)\.[tj]sx?$/i,
    agentSlug: 'tdd-london-swarm',
    routeName: 'tdd',
    description: 'Test file extension — route to TDD agent',
  },
  {
    pattern: /Dockerfile|docker-compose\.ya?ml/i,
    agentSlug: 'engineering-devops-automator',
    routeName: 'devops',
    description: 'Docker file references',
  },
  {
    pattern: /\.sol\b|solidity\b/i,
    agentSlug: 'engineering-solidity-smart-contract-engineer',
    routeName: 'solidity',
    description: 'Solidity / smart contract work',
  },
  {
    pattern: /\blsp\b|language[\s-]?server[\s-]?protocol/i,
    agentSlug: 'lsp-index-engineer',
    routeName: 'lsp',
    description: 'Language Server Protocol work',
  },
  {
    pattern: /git\s+(blame|log|rebase|cherry.pick|bisect)/i,
    agentSlug: 'engineering-git-workflow-master',
    routeName: 'git-workflow',
    description: 'Git history/rebase operations',
  },
  // ---- Infrastructure / DevOps ----
  {
    pattern: /terraform|\.tf\b|helm\s+chart|kubernetes|k8s|kubectl/i,
    agentSlug: 'engineering-devops-automator',
    routeName: 'devops',
    description: 'Infrastructure-as-code tools',
  },
  {
    pattern: /github\s+actions|\.github\/workflows|ci\.ya?ml/i,
    agentSlug: 'engineering-devops-automator',
    routeName: 'devops',
    description: 'CI/CD pipeline files',
  },
  {
    pattern: /\bdeploy(ment)?\b.*\b(staging|production|prod|canary)\b/i,
    agentSlug: 'engineering-devops-automator',
    routeName: 'devops',
    description: 'Deployment to environments',
  },
  // ---- Blockchain / Web3 ----
  {
    pattern: /\bweb3\b|ethers\.js|hardhat|foundry\b|brownie\b/i,
    agentSlug: 'engineering-solidity-smart-contract-engineer',
    routeName: 'solidity',
    description: 'Web3 development toolchain',
  },
  {
    pattern: /\bdefi\b|uniswap|aave|compound|erc-?20|erc-?721/i,
    agentSlug: 'blockchain-security-auditor',
    routeName: 'blockchain-security',
    description: 'DeFi protocol references',
  },
  // ---- Database ----
  {
    pattern: /schema\s+migration|alembic|flyway|db\s+migration/i,
    agentSlug: 'engineering-database-optimizer',
    routeName: 'database',
    description: 'Database migration tooling',
  },
  {
    pattern: /query\s+performance|slow\s+query|EXPLAIN\s+ANALYZE|index\s+hint/i,
    agentSlug: 'engineering-database-optimizer',
    routeName: 'database',
    description: 'Database query optimization',
  },
  // ---- Mobile ----
  {
    pattern: /react[\s-]?native|expo\b|metro\.config/i,
    agentSlug: 'engineering-mobile-app-builder',
    routeName: 'mobile',
    description: 'React Native / Expo',
  },
  {
    pattern: /\bswift\b|\bswiftui\b|xcode\b|\biosuikit\b/i,
    agentSlug: 'engineering-mobile-app-builder',
    routeName: 'mobile',
    description: 'iOS development',
  },
  {
    pattern: /\bkotlin\b|\bjetpack\s+compose\b|android\s+studio/i,
    agentSlug: 'engineering-mobile-app-builder',
    routeName: 'mobile',
    description: 'Android development',
  },
  // ---- Embedded / Firmware ----
  {
    pattern: /\bfirmware\b|embedded\b|rtos\b|freertos|zephyr\b|bare[\s-]?metal/i,
    agentSlug: 'engineering-embedded-firmware-engineer',
    routeName: 'embedded',
    description: 'Embedded systems / firmware',
  },
  // ---- Security ----
  {
    pattern: /owasp|penetration\s+test|pentest|xss\b|sql\s+injection|csrf\b/i,
    agentSlug: 'engineering-security-engineer',
    routeName: 'security-engineer',
    description: 'OWASP / attack pattern references',
  },
  {
    pattern: /threat\s+model|attack\s+surface|security\s+architecture/i,
    agentSlug: 'security-architect',
    routeName: 'security-architect',
    description: 'Threat modeling / security architecture',
  },
  // ---- Game Development ----
  {
    pattern: /\bunreal\s+engine\b|ue4\b|ue5\b|blueprints?\b/i,
    agentSlug: 'unreal-systems-engineer',
    routeName: 'unreal',
    description: 'Unreal Engine work',
  },
  {
    pattern: /\bunity\b.*\.(cs|unity|prefab)\b/i,
    agentSlug: 'unity-architect',
    routeName: 'unity',
    description: 'Unity Engine work',
  },
  {
    pattern: /\bgodot\b|gdscript|\.tscn\b|\.gd\b/i,
    agentSlug: 'godot-gameplay-scripter',
    routeName: 'godot',
    description: 'Godot Engine work',
  },
  // ---- Spatial / XR ----
  {
    pattern: /visionos|realitykit|arkit|metal\s+shader/i,
    agentSlug: 'visionos-spatial-engineer',
    routeName: 'visionos',
    description: 'Apple VisionOS / RealityKit',
  },
  // ---- SEO / Marketing ----
  {
    pattern: /\bseo\b|search\s+engine\s+optim|meta\s+description|backlink/i,
    agentSlug: 'marketing-seo-specialist',
    routeName: 'seo',
    description: 'SEO work',
  },
  // ---- ZK / Cryptography ----
  {
    pattern: /\bzkp\b|zero[\s-]?knowledge|circom\b|snark\b|stark\b/i,
    agentSlug: 'zk-steward',
    routeName: 'zk',
    description: 'Zero-knowledge proof systems',
  },
  // ---- Supply Chain ----
  {
    pattern: /supply\s+chain|procurement|vendor\s+risk|logistics\s+optimization/i,
    agentSlug: 'supply-chain-strategist',
    routeName: 'supply-chain',
    description: 'Supply chain / procurement',
  },
  // ---- Salesforce ----
  {
    pattern: /salesforce|apex\s+class|soql\b|lightning\s+component|force\.com/i,
    agentSlug: 'specialized-salesforce-architect',
    routeName: 'salesforce',
    description: 'Salesforce platform',
  },
  // ---- MCP / Protocol ----
  {
    pattern: /\bmcp\s+(tool|server|protocol)|model\s+context\s+protocol/i,
    agentSlug: 'specialized-mcp-builder',
    routeName: 'mcp-builder',
    description: 'MCP tool / server building',
  },
  // ---- Blender / 3D ----
  {
    pattern: /blender\b.*\.(py|blend)\b|bpy\b/i,
    agentSlug: 'blender-addon-engineer',
    routeName: 'blender',
    description: 'Blender addon development',
  },
];

/**
 * Pre-filter that runs regex checks against task descriptions before embedding.
 * First match wins — rules are tested in order.
 * Matched tasks return confidence=1.0 and method='keyword'.
 */
export class KeywordPreFilter {
  private rules: KeywordRule[];

  constructor(customRules?: KeywordRule[]) {
    // Custom rules prepended — run before defaults
    this.rules = customRules
      ? [...customRules, ...DEFAULT_KEYWORD_ROUTES]
      : [...DEFAULT_KEYWORD_ROUTES];
  }

  /**
   * Test the task description against all keyword rules.
   * Returns RouteResult with method='keyword' on first match, null otherwise.
   */
  match(taskDescription: string): RouteResult | null {
    for (const rule of this.rules) {
      if (rule.pattern.test(taskDescription)) {
        return {
          agentSlug: rule.agentSlug,
          confidence: 1.0,
          method: 'keyword',
          routeName: rule.routeName,
        };
      }
    }
    return null;
  }

  /**
   * Add a rule at runtime. Custom rules are prepended (run first).
   */
  addRule(rule: KeywordRule): void {
    this.rules.unshift(rule);
  }

  /** Returns a copy of the current rule list for inspection */
  getRules(): ReadonlyArray<KeywordRule> {
    return [...this.rules];
  }
}
```

### Modified section of `v3/@claude-flow/routing/src/route-layer.ts`

```typescript
// Add to imports at top of file:
import { KeywordPreFilter, KeywordRule } from './keyword-pre-filter.js';

// Add to RouteLayer class fields:
private keywordFilter?: KeywordPreFilter;

// Add to constructor (after existing encoder init):
if (config.enableKeywordFilter !== false) {
  this.keywordFilter = new KeywordPreFilter(config.keywordRules);
}

// Add to start of route() method, BEFORE await this.initialize():
if (this.keywordFilter) {
  const keywordResult = this.keywordFilter.match(taskDescription);
  if (keywordResult) return keywordResult;
}
```

### Updated `RouteLayerConfig` (additions to `types.ts`)

```typescript
interface RouteLayerConfig {
  routes: Route[];
  encoder?: 'hnsw' | 'local';
  debug?: boolean;
  globalThreshold?: number;
  llmFallback?: LLMFallbackConfig;
  // NEW in Task 03:
  enableKeywordFilter?: boolean;  // default: true
  keywordRules?: KeywordRule[];   // prepended before DEFAULT_KEYWORD_ROUTES
}
```

---

## 7. Testing Strategy

### Unit Tests (`tests/routing/keyword-pre-filter.test.ts`)

```typescript
import {
  KeywordPreFilter,
  DEFAULT_KEYWORD_ROUTES,
  KeywordRule,
} from '../../v3/@claude-flow/routing/src/keyword-pre-filter.js';

describe('KeywordPreFilter', () => {
  let filter: KeywordPreFilter;

  beforeEach(() => {
    filter = new KeywordPreFilter();
  });

  describe('match()', () => {
    it('returns null for a generic task with no keywords', () => {
      expect(filter.match('please help me with something')).toBeNull();
    });

    it('returns method=keyword on match', () => {
      const result = filter.match('we found CVE-2024-12345 in our dependency');
      expect(result?.method).toBe('keyword');
    });

    it('returns confidence=1.0 on match', () => {
      const result = filter.match('CVE-2023-0001 in jsonwebtoken');
      expect(result?.confidence).toBe(1.0);
    });

    // CVE rule
    it('routes CVE references to security-engineer', () => {
      const result = filter.match('CVE-2024-12345 affects our version of lodash');
      expect(result?.agentSlug).toBe('engineering-security-engineer');
    });

    // Dockerfile rule
    it('routes Dockerfile tasks to devops-automator', () => {
      const result = filter.match('update the Dockerfile to use node:20-alpine');
      expect(result?.agentSlug).toBe('engineering-devops-automator');
    });

    it('routes docker-compose.yml tasks to devops-automator', () => {
      const result = filter.match('add a redis service to docker-compose.yml');
      expect(result?.agentSlug).toBe('engineering-devops-automator');
    });

    // Test file rule
    it('routes .test.ts tasks to tdd-london-swarm', () => {
      const result = filter.match('write tests in auth.test.ts');
      expect(result?.agentSlug).toBe('tdd-london-swarm');
    });

    it('routes .spec.js tasks to tdd-london-swarm', () => {
      const result = filter.match('update the user.spec.js file');
      expect(result?.agentSlug).toBe('tdd-london-swarm');
    });

    // Solidity rule
    it('routes solidity tasks to smart-contract-engineer', () => {
      const result = filter.match('add a function to the Token.sol contract');
      expect(result?.agentSlug).toBe('engineering-solidity-smart-contract-engineer');
    });

    // Git rule
    it('routes git blame tasks to git-workflow-master', () => {
      const result = filter.match('use git blame to find who introduced this bug');
      expect(result?.agentSlug).toBe('engineering-git-workflow-master');
    });

    it('routes git rebase tasks to git-workflow-master', () => {
      const result = filter.match('help me git rebase onto main');
      expect(result?.agentSlug).toBe('engineering-git-workflow-master');
    });

    // Terraform rule
    it('routes terraform tasks to devops-automator', () => {
      const result = filter.match('write a terraform module for the VPC');
      expect(result?.agentSlug).toBe('engineering-devops-automator');
    });

    // GitHub Actions rule
    it('routes GitHub Actions tasks to devops-automator', () => {
      const result = filter.match('create a github actions workflow for CI');
      expect(result?.agentSlug).toBe('engineering-devops-automator');
    });

    // MCP builder rule
    it('routes MCP server tasks to mcp-builder', () => {
      const result = filter.match('build an MCP server for Slack integration');
      expect(result?.agentSlug).toBe('specialized-mcp-builder');
    });

    // ZK rule
    it('routes zero-knowledge proof tasks to zk-steward', () => {
      const result = filter.match('implement a zkp circuit in circom');
      expect(result?.agentSlug).toBe('zk-steward');
    });

    // OWASP rule
    it('routes OWASP tasks to security-engineer', () => {
      const result = filter.match('check this endpoint against OWASP Top 10');
      expect(result?.agentSlug).toBe('engineering-security-engineer');
    });

    // Case insensitivity
    it('is case-insensitive for dockerfile', () => {
      const result = filter.match('update the dockerfile');
      expect(result?.agentSlug).toBe('engineering-devops-automator');
    });
  });

  describe('addRule()', () => {
    it('custom rules are tested before defaults', () => {
      filter.addRule({
        pattern: /CVE-/i,
        agentSlug: 'compliance-auditor', // override default CVE routing
        routeName: 'compliance',
        description: 'Override test',
      });
      const result = filter.match('CVE-2024-0001 issue');
      expect(result?.agentSlug).toBe('compliance-auditor');
    });

    it('adds new rules that were not previously matched', () => {
      const result1 = filter.match('roblox scripting with lua');
      // roblox is in routes but not keyword — verify it passes through to null
      // (depends on whether roblox has a keyword rule — adjust if rule added)

      filter.addRule({
        pattern: /lua\s+scripting.*roblox/i,
        agentSlug: 'roblox-systems-scripter',
        routeName: 'roblox',
        description: 'Roblox Lua scripting',
      });
      const result2 = filter.match('lua scripting for roblox game');
      expect(result2?.agentSlug).toBe('roblox-systems-scripter');
    });
  });

  describe('getRules()', () => {
    it('returns all default rules', () => {
      const rules = filter.getRules();
      expect(rules.length).toBe(DEFAULT_KEYWORD_ROUTES.length);
    });

    it('returns immutable array (modifications do not affect filter)', () => {
      const rules = filter.getRules() as KeywordRule[];
      const originalLength = rules.length;
      rules.push({
        pattern: /test/,
        agentSlug: 'coder',
        routeName: 'test',
        description: 'test',
      });
      expect(filter.getRules().length).toBe(originalLength);
    });
  });
});

describe('RouteLayer keyword pre-filter integration', () => {
  it('skips embedding when keyword matches', async () => {
    const layer = new RouteLayer({
      routes: [], // no semantic routes
    });
    // Should still work via keyword filter
    const result = await layer.route('update the Dockerfile');
    expect(result.method).toBe('keyword');
    expect(result.agentSlug).toBe('engineering-devops-automator');
  });

  it('falls through to semantic when no keyword matches', async () => {
    const layer = new RouteLayer({
      routes: coreRoutes,
      enableKeywordFilter: true,
    });
    const result = await layer.route('implement the user registration system');
    // This should go through semantic routing, not keyword
    expect(result.method).toBe('semantic');
  });

  it('respects enableKeywordFilter=false', async () => {
    const layer = new RouteLayer({
      routes: coreRoutes,
      enableKeywordFilter: false,
    });
    const result = await layer.route('update the Dockerfile');
    // Without keyword filter, must go through semantic routing
    expect(result.method).not.toBe('keyword');
  });
});
```

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/routing/src/keyword-pre-filter.ts` exists with `KeywordPreFilter` class and `DEFAULT_KEYWORD_ROUTES` array
- [ ] `DEFAULT_KEYWORD_ROUTES` contains at minimum 20 rules covering: CVE, test files, Dockerfile, Solidity, git operations, Terraform, GitHub Actions, Kubernetes, React Native, iOS/Swift, Android/Kotlin, embedded/firmware, OWASP, threat modeling, ZK proofs, Salesforce, MCP builder, Blender, Unreal, Unity, Godot, SEO, supply chain
- [ ] All regex patterns are case-insensitive (`/i` flag)
- [ ] `KeywordPreFilter.match()` returns `RouteResult | null` — never throws
- [ ] `KeywordPreFilter.addRule()` prepends custom rules before defaults
- [ ] `RouteLayer.route()` calls keyword filter BEFORE computing embeddings
- [ ] When keyword matches: `confidence === 1.0`, `method === 'keyword'`
- [ ] `enableKeywordFilter: false` in `RouteLayerConfig` bypasses the pre-filter
- [ ] All unit tests pass: every rule in `DEFAULT_KEYWORD_ROUTES` has at least one passing test case
- [ ] Integration test confirms embedding is bypassed on keyword match (use empty `routes: []` to prove it)
- [ ] No TypeScript `any` types
- [ ] File is under 500 lines
