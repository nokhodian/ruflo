# Task 01: Semantic RouteLayer (Replace Hardcoded Routing Codes)

**Priority:** Phase 1 — Foundation  
**Effort:** Medium  
**Depends on:** none  
**Blocks:** 02-llm-fallback-routing, 03-keyword-routing, 04-capability-metadata

---

## 1. Current State

Routing in ruflo is entirely hardcoded. The only routing logic lives in:

- **`.agents/skills/agent-coordination/SKILL.md`** — lines 105–113 define a static table mapping integer codes 1–13 to agent type lists:
  ```
  | Code | Task | Agents |
  |------|------|--------|
  | 1 | Bug Fix | coordinator, researcher, coder, tester |
  | 3 | Feature | coordinator, architect, coder, tester, reviewer |
  | 5 | Refactor | coordinator, architect, coder, reviewer |
  | 7 | Performance | coordinator, perf-engineer, coder |
  | 9 | Security | coordinator, security-architect, auditor |
  ```

- **`v3/mcp/tools/agent-tools.ts`** — lines 32–137 define `ALLOWED_AGENT_TYPES` (a const array of 230+ slugs). The `spawnAgentSchema` (lines 151–157) accepts an `agentType` field validated against this array. There is no routing logic — the caller must supply the exact slug.

- **`v3/@claude-flow/cli/src/commands/agent.ts`** — the `agent spawn` CLI command passes the type directly to the MCP tool with no intermediate routing logic.

- **`v3/@claude-flow/cli/src/commands/route.ts`** — this file exists but contains only stub logic; it does not implement utterance-based routing.

There is **no package** at `v3/@claude-flow/routing/`. No embedding infrastructure for routing exists.

---

## 2. Gap Analysis

**What is missing:**

1. **No semantic matching.** A user typing "check our API for injection risks" cannot be automatically routed to `engineering-security-engineer`. They must know the slug.
2. **No utterance database.** There is no corpus of representative task descriptions per agent to compute similarity against.
3. **No embedding pipeline for routing.** The existing HNSW search in `v3/@claude-flow/memory/` is for agent memory retrieval, not routing.
4. **Routing codes are brittle.** Adding a new agent category requires editing `SKILL.md`. With 230+ agents, the 13-code table is wildly under-representative.
5. **No confidence scoring.** All routing decisions are binary — no signal about how well a task description matches a given agent.
6. **No fallback path.** Misrouted tasks silently fail or run with the wrong specialist.

**Failure modes without this task:**
- Tasks 02 and 03 have nothing to extend — they depend on `RouteLayer` existing.
- Task 04's capability metadata has no consumer that can use it for routing.
- Any routing improvement in the improvement plan stalls at the foundation.

---

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/routing/src/route-layer.ts` | Core `RouteLayer` class with `route()` method and cosine similarity matching |
| `v3/@claude-flow/routing/src/types.ts` | `Route`, `RouteResult`, `RouteLayerConfig`, `AgentCapability` interfaces |
| `v3/@claude-flow/routing/src/encoder.ts` | Embedding adapter: wraps AgentDB HNSW to produce float[] vectors from strings |
| `v3/@claude-flow/routing/src/cosine.ts` | Pure cosine similarity function + centroid computation utility |
| `v3/@claude-flow/routing/src/routes/index.ts` | Barrel export for all route definitions |
| `v3/@claude-flow/routing/src/routes/engineering.route.ts` | Route definitions for all `engineering-*` agents |
| `v3/@claude-flow/routing/src/routes/security.route.ts` | Route definitions for security-related agents |
| `v3/@claude-flow/routing/src/routes/testing.route.ts` | Route definitions for testing agents |
| `v3/@claude-flow/routing/src/routes/design.route.ts` | Route definitions for design agents |
| `v3/@claude-flow/routing/src/routes/marketing.route.ts` | Route definitions for marketing agents |
| `v3/@claude-flow/routing/src/routes/product.route.ts` | Route definitions for product/project management agents |
| `v3/@claude-flow/routing/src/routes/specialized.route.ts` | Route definitions for specialized/support/sales agents |
| `v3/@claude-flow/routing/src/routes/game-dev.route.ts` | Route definitions for game development agents |
| `v3/@claude-flow/routing/src/routes/core.route.ts` | Route definitions for core agents (coder, reviewer, tester, planner, researcher) |
| `v3/@claude-flow/routing/src/index.ts` | Package barrel export |
| `v3/@claude-flow/routing/package.json` | Package manifest for `@claude-flow/routing` |
| `v3/@claude-flow/routing/tsconfig.json` | TypeScript configuration |
| `tests/routing/route-layer.test.ts` | Unit tests for RouteLayer |
| `tests/routing/fixtures/routing-benchmark.json` | 100-task benchmark set with expected agent slugs |

---

## 4. Files to Modify

| Path | Change |
|------|--------|
| `.agents/skills/agent-coordination/SKILL.md` | Replace the static codes 1–13 table (lines 105–113) with a reference to the RouteLayer. Keep the table as a legacy fallback reference only, clearly marked deprecated. Add usage instructions for the RouteLayer CLI. |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Import `RouteLayer` from `@claude-flow/routing`. In the `spawn` subcommand handler, if `--type` is not provided, call `routeLayer.route(taskDescription)` to resolve the agent slug before spawning. |
| `v3/@claude-flow/cli/src/commands/route.ts` | Replace stub with full implementation that invokes `RouteLayer.route()` and prints result with confidence. |
| `v3/@claude-flow/cli/src/index.ts` | Ensure `route` command is registered (may already be; verify). |

---

## 5. Implementation Steps

### Step 1: Create the package scaffold

Create `v3/@claude-flow/routing/package.json`:
```json
{
  "name": "@claude-flow/routing",
  "version": "3.5.0",
  "description": "Semantic task-to-agent routing for ruflo",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "node --experimental-vm-modules node_modules/.bin/jest"
  },
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0"
  }
}
```

Create `v3/@claude-flow/routing/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

### Step 2: Create core types (`v3/@claude-flow/routing/src/types.ts`)

Write the complete interface file — see Section 6.

### Step 3: Create cosine similarity utility (`v3/@claude-flow/routing/src/cosine.ts`)

Write `cosineSimilarity(a: number[], b: number[]): number` and `computeCentroid(vectors: number[][]): number[]` — see Section 6.

### Step 4: Create the encoder adapter (`v3/@claude-flow/routing/src/encoder.ts`)

The encoder must produce float[] vectors from strings. Use the existing `v3/@claude-flow/memory/src/hnsw-index.ts` (or `hnsw-lite.ts`) embedding capability as the backend. Read those files first to understand their API.

The encoder must:
- Accept a string input
- Return `Promise<number[]>` (embedding vector)
- Cache embeddings in memory (Map keyed by string hash) to avoid re-encoding utterances on every `route()` call
- Expose `encodeAll(texts: string[]): Promise<number[][]>` for batch utterance pre-computation

### Step 5: Create the RouteLayer (`v3/@claude-flow/routing/src/route-layer.ts`)

Core algorithm:
1. On construction, encode all utterances from all registered routes into centroids (one centroid per route = mean of its utterance vectors)
2. On `route(taskDescription)`:
   a. Encode the task description
   b. Compute cosine similarity vs. every route centroid
   c. Return the route with the highest similarity score
   d. If `maxScore < route.threshold`, set `method: 'llm_fallback'` on the result (Task 02 handles this)
   e. If `maxScore >= route.threshold`, set `method: 'semantic'`

See Section 6 for the full class template.

### Step 6: Create route definition files

For each category, write a `.route.ts` file containing an array of `Route` objects. Each route has 10–15 utterances. Start with the most common categories:

**Step 6a:** Write `v3/@claude-flow/routing/src/routes/core.route.ts`
**Step 6b:** Write `v3/@claude-flow/routing/src/routes/security.route.ts`
**Step 6c:** Write `v3/@claude-flow/routing/src/routes/engineering.route.ts`
**Step 6d:** Write `v3/@claude-flow/routing/src/routes/testing.route.ts`
**Step 6e:** Write `v3/@claude-flow/routing/src/routes/design.route.ts`
**Step 6f:** Write `v3/@claude-flow/routing/src/routes/marketing.route.ts`
**Step 6g:** Write `v3/@claude-flow/routing/src/routes/product.route.ts`
**Step 6h:** Write `v3/@claude-flow/routing/src/routes/specialized.route.ts`
**Step 6i:** Write `v3/@claude-flow/routing/src/routes/game-dev.route.ts`
**Step 6j:** Write `v3/@claude-flow/routing/src/routes/index.ts` (barrel export)

### Step 7: Create the package index (`v3/@claude-flow/routing/src/index.ts`)

Export: `RouteLayer`, `Route`, `RouteResult`, `RouteLayerConfig`, `AgentCapability`, `cosineSimilarity`, `computeCentroid`.

### Step 8: Modify `v3/@claude-flow/cli/src/commands/route.ts`

Read the file first. Replace stub with:
```typescript
import { RouteLayer } from '@claude-flow/routing';
import { ALL_ROUTES } from '@claude-flow/routing/routes';

// In the command handler:
const layer = new RouteLayer({ routes: ALL_ROUTES });
const result = await layer.route(taskDescription);
console.log(JSON.stringify(result, null, 2));
```

### Step 9: Modify `v3/@claude-flow/cli/src/commands/agent.ts`

Read the file first. In the `spawn` subcommand:
- If `--type` flag is absent but `--task` is provided, invoke `RouteLayer.route(task)` and use the returned `agentSlug` as the type
- Print the routing decision to stderr with confidence score before spawning

### Step 10: Update `SKILL.md`

Read the file first. Mark the codes 1–13 table as deprecated. Add a new section:
```markdown
## Routing (Current: Semantic RouteLayer)
Use `npx claude-flow@v3alpha route --task "your task description"` to resolve the optimal agent.
The RouteLayer computes cosine similarity against 10–15 representative utterances per agent category.
```

### Step 11: Write unit tests

Create `tests/routing/route-layer.test.ts` with the test cases from Section 7.

### Step 12: Create benchmark fixture

Create `tests/routing/fixtures/routing-benchmark.json` with 100 task descriptions and their expected agent slugs. Use diverse phrasings — see Section 7 for format.

---

## 6. Key Code Templates

### `v3/@claude-flow/routing/src/types.ts`
```typescript
export interface Route {
  /** Unique name for this route, typically an agent category */
  name: string;
  /** The agent slug from ALLOWED_AGENT_TYPES to dispatch to */
  agentSlug: string;
  /** 10–15 representative task descriptions for this agent */
  utterances: string[];
  /** Minimum cosine similarity required for a confident match (default: 0.72) */
  threshold: number;
  /** If true and confidence < threshold, escalate to LLM classifier */
  fallbackToLLM: boolean;
  /** Human-readable description of what this agent handles */
  description?: string;
}

export interface RouteResult {
  /** The resolved agent slug from ALLOWED_AGENT_TYPES */
  agentSlug: string;
  /** Cosine similarity score (0.0–1.0) */
  confidence: number;
  /** How the routing decision was made */
  method: 'semantic' | 'keyword' | 'llm_fallback';
  /** The route name that matched */
  routeName: string;
  /** All routes with their scores, for debugging */
  allScores?: Array<{ routeName: string; agentSlug: string; score: number }>;
}

export interface RouteLayerConfig {
  routes: Route[];
  /** Encoder type to use for embeddings */
  encoder?: 'hnsw' | 'local';
  /** If true, include all route scores in RouteResult */
  debug?: boolean;
  /** Global minimum threshold override */
  globalThreshold?: number;
}

export interface AgentCapability {
  slug: string;
  description: string;
  taskTypes: string[];
  expertise: string[];
}
```

### `v3/@claude-flow/routing/src/cosine.ts`
```typescript
/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1], where 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * Compute the mean centroid of a list of vectors.
 * All vectors must have the same dimensionality.
 */
export function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error('Cannot compute centroid of empty array');
  const dim = vectors[0].length;
  const centroid = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroid[i] /= vectors.length;
  }
  return centroid;
}
```

### `v3/@claude-flow/routing/src/encoder.ts`
```typescript
import { createHash } from 'crypto';

export interface Encoder {
  encode(text: string): Promise<number[]>;
  encodeAll(texts: string[]): Promise<number[][]>;
}

/**
 * Local encoder that produces deterministic pseudo-embeddings from text.
 * Used as a fallback when no real embedding model is available.
 * NOTE: Real semantic routing requires a real embedding model.
 * In production, replace this with the HNSW embedding backend.
 */
export class LocalEncoder implements Encoder {
  private readonly DIM = 256;
  private cache = new Map<string, number[]>();

  async encode(text: string): Promise<number[]> {
    const key = createHash('sha256').update(text.toLowerCase().trim()).digest('hex');
    if (this.cache.has(key)) return this.cache.get(key)!;

    // Deterministic pseudo-embedding: hash n-grams to float positions
    const vector = new Array(this.DIM).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      const hash = createHash('md5').update(word).digest();
      for (let i = 0; i < Math.min(hash.length, this.DIM); i++) {
        vector[i % this.DIM] += (hash[i] - 128) / 128;
      }
    }
    // L2 normalize
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    const normalized = vector.map(v => v / norm);
    this.cache.set(key, normalized);
    return normalized;
  }

  async encodeAll(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.encode(t)));
  }
}

/**
 * Production encoder backed by the ruflo HNSW embedding infrastructure.
 * Import and use HNSWIndex from v3/@claude-flow/memory/src/hnsw-index.ts.
 */
export class HNSWEncoder implements Encoder {
  // TODO in Task 04: wire to actual HNSW embedding backend
  private fallback = new LocalEncoder();

  async encode(text: string): Promise<number[]> {
    return this.fallback.encode(text);
  }

  async encodeAll(texts: string[]): Promise<number[][]> {
    return this.fallback.encodeAll(texts);
  }
}
```

### `v3/@claude-flow/routing/src/route-layer.ts`
```typescript
import { Route, RouteResult, RouteLayerConfig } from './types.js';
import { cosineSimilarity, computeCentroid } from './cosine.js';
import { LocalEncoder, Encoder } from './encoder.js';

interface RouteCentroid {
  route: Route;
  centroid: number[];
}

export class RouteLayer {
  private centroids: RouteCentroid[] = [];
  private encoder: Encoder;
  private config: RouteLayerConfig;
  private initialized = false;

  constructor(config: RouteLayerConfig) {
    this.config = config;
    this.encoder = new LocalEncoder(); // swap for HNSWEncoder in production
  }

  /**
   * Pre-compute centroids for all routes.
   * Must be called before route() — or call route() which auto-initializes.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.centroids = await Promise.all(
      this.config.routes.map(async (route) => {
        const vectors = await this.encoder.encodeAll(route.utterances);
        const centroid = computeCentroid(vectors);
        return { route, centroid };
      })
    );
    this.initialized = true;
  }

  /**
   * Route a task description to the most appropriate agent slug.
   */
  async route(taskDescription: string): Promise<RouteResult> {
    await this.initialize();

    const taskVector = await this.encoder.encode(taskDescription);

    const scores = this.centroids.map(({ route, centroid }) => ({
      routeName: route.name,
      agentSlug: route.agentSlug,
      score: cosineSimilarity(taskVector, centroid),
      threshold: route.threshold,
      fallbackToLLM: route.fallbackToLLM,
    }));

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];

    const method: RouteResult['method'] =
      best.score < best.threshold ? 'llm_fallback' : 'semantic';

    const result: RouteResult = {
      agentSlug: best.agentSlug,
      confidence: best.score,
      method,
      routeName: best.routeName,
    };

    if (this.config.debug) {
      result.allScores = scores.map(s => ({
        routeName: s.routeName,
        agentSlug: s.agentSlug,
        score: s.score,
      }));
    }

    return result;
  }

  /**
   * Register an additional route at runtime without re-initializing all centroids.
   */
  async addRoute(route: Route): Promise<void> {
    const vectors = await this.encoder.encodeAll(route.utterances);
    const centroid = computeCentroid(vectors);
    this.centroids.push({ route, centroid });
    this.config.routes.push(route);
  }
}
```

### `v3/@claude-flow/routing/src/routes/security.route.ts`
```typescript
import { Route } from '../types.js';

export const securityRoutes: Route[] = [
  {
    name: 'security-engineer',
    agentSlug: 'engineering-security-engineer',
    threshold: 0.72,
    fallbackToLLM: true,
    description: 'Application security, vulnerability scanning, CVE analysis',
    utterances: [
      'audit the authentication system for vulnerabilities',
      'check for SQL injection risks in the API',
      'review JWT token handling and security',
      'scan for CVEs in npm dependencies',
      'implement input sanitization to prevent XSS',
      'find cross-site scripting vulnerabilities in the frontend',
      'review the OAuth flow for security issues',
      'check for privilege escalation paths in the role system',
      'validate CORS configuration against OWASP guidelines',
      'review cryptographic key management practices',
      'check for insecure direct object references in the endpoints',
      'audit the session management implementation',
      'review security headers in HTTP responses',
      'check for sensitive data exposure in API responses',
    ],
  },
  {
    name: 'security-architect',
    agentSlug: 'security-architect',
    threshold: 0.72,
    fallbackToLLM: true,
    description: 'Security architecture design, threat modeling',
    utterances: [
      'design a zero-trust security architecture',
      'create a threat model for the payment system',
      'design security boundaries between microservices',
      'architect the authentication and authorization system',
      'define the security posture for the new infrastructure',
      'design secrets management and rotation policies',
      'create a data classification and access control framework',
      'design the security monitoring and alerting architecture',
      'architect the network segmentation strategy',
      'define the cryptography standards and key hierarchy',
    ],
  },
  {
    name: 'blockchain-security-auditor',
    agentSlug: 'blockchain-security-auditor',
    threshold: 0.75,
    fallbackToLLM: true,
    description: 'Smart contract security, blockchain vulnerability analysis',
    utterances: [
      'audit the Solidity smart contract for reentrancy vulnerabilities',
      'check for integer overflow in the token contract',
      'review the ERC-20 implementation for security flaws',
      'audit the DeFi protocol for flash loan attack vectors',
      'check for front-running vulnerabilities in the DEX',
      'review the access control in the smart contract',
      'audit the oracle integration for manipulation risks',
      'check for gas optimization and DoS vectors in the contract',
    ],
  },
];
```

### `v3/@claude-flow/routing/src/routes/core.route.ts`
```typescript
import { Route } from '../types.js';

export const coreRoutes: Route[] = [
  {
    name: 'coder',
    agentSlug: 'coder',
    threshold: 0.65,
    fallbackToLLM: true,
    description: 'General code implementation',
    utterances: [
      'implement the user registration feature',
      'write the function to calculate shipping costs',
      'code the database migration script',
      'build the REST API endpoint for creating orders',
      'implement the caching layer for the search results',
      'write the TypeScript interface for the user model',
      'code the background job for sending notification emails',
      'implement the file upload handler',
      'build the data transformation pipeline',
      'write the utility function for date formatting',
    ],
  },
  {
    name: 'reviewer',
    agentSlug: 'reviewer',
    threshold: 0.68,
    fallbackToLLM: true,
    description: 'Code review and quality assessment',
    utterances: [
      'review this pull request for code quality',
      'check this code for best practices violations',
      'review the implementation for potential issues',
      'give feedback on this TypeScript module',
      'check this function for edge cases and bugs',
      'review the database query for performance issues',
      'look over this class design and suggest improvements',
      'review the error handling in this module',
      'check this code against our coding standards',
      'evaluate the readability and maintainability of this code',
    ],
  },
  {
    name: 'tester',
    agentSlug: 'tester',
    threshold: 0.68,
    fallbackToLLM: true,
    description: 'Writing tests, test coverage analysis',
    utterances: [
      'write unit tests for the authentication module',
      'create integration tests for the payment API',
      'write Jest tests for this TypeScript class',
      'generate test cases for the user registration flow',
      'write end-to-end tests for the checkout process',
      'create test fixtures for the database layer',
      'write property-based tests for the validation logic',
      'generate mock data for testing the API endpoints',
      'write snapshot tests for these React components',
      'create the test harness for the background workers',
    ],
  },
  {
    name: 'researcher',
    agentSlug: 'researcher',
    threshold: 0.65,
    fallbackToLLM: true,
    description: 'Research, analysis, and investigation',
    utterances: [
      'research the best approach for implementing rate limiting',
      'investigate the root cause of this performance regression',
      'analyze the existing codebase architecture',
      'research alternatives to our current authentication approach',
      'investigate which database is best for this use case',
      'analyze the error patterns in the production logs',
      'research the state of the art for vector search',
      'investigate the security implications of this design',
      'analyze the token usage patterns across our agents',
      'research how other systems solve this distributed consensus problem',
    ],
  },
];
```

---

## 7. Testing Strategy

### Unit Tests (`tests/routing/route-layer.test.ts`)

```typescript
import { RouteLayer } from '../../v3/@claude-flow/routing/src/route-layer.js';
import { coreRoutes } from '../../v3/@claude-flow/routing/src/routes/core.route.js';
import { securityRoutes } from '../../v3/@claude-flow/routing/src/routes/security.route.js';

describe('RouteLayer', () => {
  let layer: RouteLayer;

  beforeEach(() => {
    layer = new RouteLayer({
      routes: [...coreRoutes, ...securityRoutes],
      debug: true,
    });
  });

  describe('route()', () => {
    it('returns a RouteResult with required fields', async () => {
      const result = await layer.route('implement the login endpoint');
      expect(result).toHaveProperty('agentSlug');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('method');
      expect(result).toHaveProperty('routeName');
    });

    it('routes implementation task to coder', async () => {
      const result = await layer.route('implement the password reset functionality');
      expect(result.agentSlug).toBe('coder');
      expect(result.method).toBe('semantic');
    });

    it('routes security task to security-engineer', async () => {
      const result = await layer.route('audit the JWT token handling for vulnerabilities');
      expect(result.agentSlug).toBe('engineering-security-engineer');
    });

    it('routes review task to reviewer', async () => {
      const result = await layer.route('review this pull request for code quality issues');
      expect(result.agentSlug).toBe('reviewer');
    });

    it('returns all scores when debug=true', async () => {
      const result = await layer.route('write tests for the API');
      expect(result.allScores).toBeDefined();
      expect(result.allScores!.length).toBeGreaterThan(0);
    });

    it('returns confidence in [0, 1]', async () => {
      const result = await layer.route('some random task');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('marks low-confidence results as llm_fallback', async () => {
      // Override with very high threshold to force fallback
      const strictLayer = new RouteLayer({
        routes: coreRoutes.map(r => ({ ...r, threshold: 0.999 })),
      });
      const result = await strictLayer.route('do something');
      expect(result.method).toBe('llm_fallback');
    });
  });

  describe('addRoute()', () => {
    it('adds a new route and routes to it', async () => {
      await layer.addRoute({
        name: 'test-custom',
        agentSlug: 'testing-api-tester',
        threshold: 0.5,
        fallbackToLLM: false,
        utterances: [
          'run API endpoint tests against the staging environment',
          'execute integration tests for the REST API',
          'test the HTTP endpoints for correct status codes',
        ],
      });
      const result = await layer.route('run API endpoint tests against staging');
      expect(result.agentSlug).toBe('testing-api-tester');
    });
  });

  describe('initialize()', () => {
    it('is idempotent — calling twice does not duplicate centroids', async () => {
      await layer.initialize();
      const routeCountBefore = layer['centroids'].length;
      await layer.initialize();
      expect(layer['centroids'].length).toBe(routeCountBefore);
    });
  });
});
```

### Benchmark Test (`tests/routing/benchmark.test.ts`)

```typescript
import { RouteLayer } from '../../v3/@claude-flow/routing/src/route-layer.js';
import { ALL_ROUTES } from '../../v3/@claude-flow/routing/src/routes/index.js';
import benchmark from './fixtures/routing-benchmark.json' assert { type: 'json' };

describe('RouteLayer benchmark (100-task set)', () => {
  let layer: RouteLayer;

  beforeAll(async () => {
    layer = new RouteLayer({ routes: ALL_ROUTES });
    await layer.initialize();
  });

  it('achieves >= 80% accuracy on benchmark set', async () => {
    let correct = 0;
    for (const { task, expectedSlug } of benchmark) {
      const result = await layer.route(task);
      if (result.agentSlug === expectedSlug) correct++;
    }
    const accuracy = correct / benchmark.length;
    console.log(`Routing accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${benchmark.length})`);
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it('completes all 100 routings in < 5 seconds total', async () => {
    const start = Date.now();
    await Promise.all(benchmark.map(({ task }) => layer.route(task)));
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
```

### Benchmark Fixture Format (`tests/routing/fixtures/routing-benchmark.json`)

```json
[
  { "task": "implement the password reset endpoint", "expectedSlug": "coder" },
  { "task": "audit JWT token validation for security flaws", "expectedSlug": "engineering-security-engineer" },
  { "task": "write Jest unit tests for the auth module", "expectedSlug": "tester" },
  { "task": "review this PR for code quality", "expectedSlug": "reviewer" },
  { "task": "investigate the performance bottleneck in the query layer", "expectedSlug": "researcher" },
  ...95 more entries covering all major agent categories
]
```

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/routing/` package exists and builds without TypeScript errors
- [ ] `RouteLayer` class is exported from `@claude-flow/routing`
- [ ] All route definition files exist for: core, security, engineering, testing, design, marketing, product, specialized, game-dev
- [ ] Each route file has at minimum 8 utterances per route
- [ ] Unit tests pass: `npm test` in `v3/@claude-flow/routing/`
- [ ] Benchmark test achieves >= 80% accuracy on the 100-task fixture set
- [ ] `cosineSimilarity` returns values in [-1, 1]; centroid test validates correct mean
- [ ] `npx claude-flow@v3alpha route --task "..."` resolves and prints JSON `RouteResult`
- [ ] `npx claude-flow@v3alpha agent spawn --task "..."` (without `--type`) resolves slug via RouteLayer
- [ ] SKILL.md updated: codes 1–13 table marked deprecated, RouteLayer usage documented
- [ ] No TypeScript `any` types in the new package
- [ ] All files are under 500 lines
- [ ] Task 02 (LLM fallback) has a clean hook point: `result.method === 'llm_fallback'` is detectable
