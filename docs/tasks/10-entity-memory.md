# Task 10: Entity Memory (Knowledge Graph)
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Medium  
**Depends on:** Task 09 (Multi-Tier Memory — `EntityMemory` class must exist)  
**Blocks:** None

---

## 1. Current State

After Task 09, `v3/@claude-flow/memory/src/tiers/entity.ts` provides a bare `EntityMemory` SQLite KV store.  
What is missing is the **background extraction pipeline** that automatically populates that store after agent runs.

**Relevant files today:**
- `v3/@claude-flow/memory/src/tiers/entity.ts` — EntityMemory class (created in Task 09)
- `v3/@claude-flow/hooks/src/workers/index.ts` — exports background workers
- `v3/@claude-flow/hooks/src/daemons/index.ts` — DaemonManager, MetricsDaemon, SwarmMonitorDaemon, HooksLearningDaemon
- `v3/@claude-flow/hooks/src/types.ts` — `HookEvent`, `HookContext`, `HookHandler`
- `v3/@claude-flow/hooks/src/registry/index.ts` — `registerHook`
- `v3/mcp/tools/memory-tools.ts` — existing memory MCP tools
- `v3/mcp/tools/agent-tools.ts` — `handleSpawnAgent`, `handleTerminateAgent` — places where run-end can be detected

**Hook events available in `HookEvent` enum:**
- `HookEvent.PostTask` — fires after each agent task completes
- `HookEvent.SessionEnd` — fires when session ends
- `HookEvent.AgentTerminate` — fires when agent is terminated

**Background workers today:** `v3/@claude-flow/hooks/src/workers/index.ts` exports one file (`session-hook.ts`). There are no dedicated background workers for entity extraction.

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No `EntityExtractorWorker` | Entity facts are never populated automatically |
| No LLM extraction call wired to `PostTask` hook | Agents re-derive the same entity facts on every run |
| No MCP tool to query entity memory | Agents cannot read entity facts via MCP |
| No entity fact expiry cleanup daemon | Stale facts accumulate indefinitely |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/workers/entity-extractor.ts` | Background worker; reads run transcript from hook context; calls LLM to extract `EntityFact[]`; writes to `EntityMemory` |
| `v3/@claude-flow/hooks/src/workers/entity-cleanup.ts` | Daemon that deletes expired entity facts; runs on `SessionEnd` |
| `v3/mcp/tools/entity-tools.ts` | New MCP tool `entity/get` and `entity/store` so agents can read/write entity facts |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/@claude-flow/hooks/src/workers/index.ts` | Export `EntityExtractorWorker` and `EntityCleanupWorker` | Make workers accessible to daemon manager |
| `v3/@claude-flow/hooks/src/daemons/index.ts` | Wire `EntityExtractorWorker` to `PostTask` hook via `registerHook` | Automatic extraction after each run |
| `v3/mcp/tools/index.ts` | Add `entityTools` to the exported tool list | Register new MCP tools |

---

## 5. Implementation Steps

**Step 1 — Create `v3/@claude-flow/hooks/src/workers/entity-extractor.ts`**

```typescript
import { registerHook } from '../registry/index.js';
import { HookEvent, HookPriority, type HookContext } from '../types.js';
import { EntityMemory, type EntityFact } from '@claude-flow/memory';

/** Prompt sent to LLM to extract entity facts from a run transcript */
function buildExtractionPrompt(transcript: string): string {
  return `Extract named entity facts from the following agent run transcript.
Return a JSON array of objects with keys: entity, factType, value, confidence (0.0-1.0).

Examples of entity types: file paths, API endpoints, library names, CVE IDs, user IDs, repo names.
Examples of fact types: "uses_library", "has_vulnerability", "owner", "version", "status".

Transcript:
${transcript.slice(0, 6000)}

Respond with ONLY a JSON array, no prose.`;
}

async function callLLM(prompt: string): Promise<string> {
  // Use cheap model — import lazily to avoid circular deps
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = msg.content[0];
  return block.type === 'text' ? block.text : '[]';
}

function parseEntityFacts(raw: string, runId: string): EntityFact[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f: any) =>
          typeof f.entity === 'string' &&
          typeof f.factType === 'string' &&
          typeof f.value === 'string'
      )
      .map(
        (f: any): EntityFact => ({
          entity: f.entity,
          factType: f.factType,
          value: f.value,
          confidence: typeof f.confidence === 'number' ? f.confidence : 0.8,
          sourceRunId: runId,
          createdAt: Date.now(),
        })
      );
  } catch {
    return [];
  }
}

export class EntityExtractorWorker {
  constructor(private entityMemory: EntityMemory) {}

  register(): void {
    registerHook({
      event: HookEvent.PostTask,
      priority: HookPriority.Background,
      handler: async (ctx: HookContext) => {
        const transcript = ctx.data?.transcript as string | undefined;
        const runId = (ctx.data?.taskId as string) ?? `run-${Date.now()}`;

        if (!transcript || transcript.length < 50) {
          return { success: true };
        }

        try {
          const prompt = buildExtractionPrompt(transcript);
          const raw = await callLLM(prompt);
          const facts = parseEntityFacts(raw, runId);

          for (const fact of facts) {
            this.entityMemory.store(fact);
          }

          return { success: true, metadata: { extractedFacts: facts.length } };
        } catch (err) {
          // Never block task completion due to extraction failure
          console.error('[EntityExtractorWorker] extraction failed:', err);
          return { success: true };
        }
      },
    });
  }
}
```

**Step 2 — Create `v3/@claude-flow/hooks/src/workers/entity-cleanup.ts`**

```typescript
import { registerHook } from '../registry/index.js';
import { HookEvent, HookPriority } from '../types.js';
import { EntityMemory } from '@claude-flow/memory';

export class EntityCleanupWorker {
  constructor(private entityMemory: EntityMemory) {}

  register(): void {
    registerHook({
      event: HookEvent.SessionEnd,
      priority: HookPriority.Background,
      handler: async (_ctx) => {
        // EntityMemory.retrieve() already filters by expiresAt in SQL.
        // This worker does an explicit purge pass for housekeeping.
        try {
          const pruned = this.entityMemory.pruneExpired();
          return { success: true, metadata: { prunedFacts: pruned } };
        } catch {
          return { success: true };
        }
      },
    });
  }
}
```

Add `pruneExpired()` to `EntityMemory` in `v3/@claude-flow/memory/src/tiers/entity.ts`:
```typescript
pruneExpired(): number {
  const result = this.db.prepare(
    'DELETE FROM entity_facts WHERE expires_at IS NOT NULL AND expires_at <= ?'
  ).run(Date.now());
  return result.changes;
}
```

**Step 3 — Create `v3/mcp/tools/entity-tools.ts`**

```typescript
import { z } from 'zod';
import { MCPTool } from '../types.js';
import { EntityMemory, type EntityFact } from '@claude-flow/memory';

// Singleton — injected at server startup via context
let _entityMemory: EntityMemory | null = null;
export function setEntityMemory(em: EntityMemory): void { _entityMemory = em; }

function getEntityMemory(): EntityMemory {
  if (!_entityMemory) throw new Error('EntityMemory not initialized');
  return _entityMemory;
}

const getEntitySchema = z.object({
  entity: z.string().describe('Entity name, e.g. "src/auth/jwt.ts" or "CVE-2024-1234"'),
});

const storeEntitySchema = z.object({
  entity: z.string(),
  factType: z.string().describe('Category of fact, e.g. "uses_library", "has_vulnerability"'),
  value: z.string(),
  confidence: z.number().min(0).max(1).default(1.0),
  ttlMs: z.number().optional().describe('Optional time-to-live in milliseconds'),
});

export const getEntityTool: MCPTool = {
  name: 'entity/get',
  description: 'Retrieve all known facts about a named entity from entity memory',
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', description: 'Entity name to look up' },
    },
    required: ['entity'],
  },
  handler: async (input) => {
    const { entity } = getEntitySchema.parse(input);
    const facts = getEntityMemory().retrieve(entity);
    return { entity, facts, count: facts.length };
  },
  category: 'memory',
  tags: ['memory', 'entity', 'knowledge-graph'],
  version: '1.0.0',
};

export const storeEntityTool: MCPTool = {
  name: 'entity/store',
  description: 'Store a named entity fact in entity memory for future agent use',
  inputSchema: {
    type: 'object',
    properties: {
      entity:     { type: 'string' },
      factType:   { type: 'string' },
      value:      { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      ttlMs:      { type: 'number', description: 'Optional TTL in milliseconds' },
    },
    required: ['entity', 'factType', 'value'],
  },
  handler: async (input) => {
    const parsed = storeEntitySchema.parse(input);
    const fact: EntityFact = {
      entity: parsed.entity,
      factType: parsed.factType,
      value: parsed.value,
      confidence: parsed.confidence,
      sourceRunId: 'manual',
      createdAt: Date.now(),
      expiresAt: parsed.ttlMs ? Date.now() + parsed.ttlMs : undefined,
    };
    getEntityMemory().store(fact);
    return { success: true, fact };
  },
  category: 'memory',
  tags: ['memory', 'entity', 'knowledge-graph'],
  version: '1.0.0',
};

export const entityTools: MCPTool[] = [getEntityTool, storeEntityTool];
export default entityTools;
```

**Step 4 — Update `v3/@claude-flow/hooks/src/workers/index.ts`**

Append:
```typescript
export { EntityExtractorWorker } from './entity-extractor.js';
export { EntityCleanupWorker } from './entity-cleanup.js';
```

**Step 5 — Wire workers in `v3/@claude-flow/hooks/src/daemons/index.ts`**

Inside `DaemonManager.start()` or equivalent initialization, add:
```typescript
import { EntityExtractorWorker, EntityCleanupWorker } from '../workers/index.js';
import { EntityMemory } from '@claude-flow/memory';

// Initialization (path from config or env)
const entityMemory = new EntityMemory(process.env.ENTITY_DB_PATH ?? './data/memory/entities.db');
new EntityExtractorWorker(entityMemory).register();
new EntityCleanupWorker(entityMemory).register();
```

**Step 6 — Register entity tools in `v3/mcp/tools/index.ts`**

```typescript
import { entityTools, setEntityMemory } from './entity-tools.js';
// ...in tool list:
export const allTools = [...existingTools, ...entityTools];
```

---

## 6. Key Code Templates

### EntityFact interface (from Task 09 `tiers/entity.ts`)
```typescript
export interface EntityFact {
  entity: string;        // e.g., "src/auth/jwt.ts"
  factType: string;      // e.g., "uses_library"
  value: string;         // e.g., "jsonwebtoken@8.5.1"
  confidence: number;    // 0.0–1.0
  sourceRunId: string;
  createdAt: number;     // epoch ms
  expiresAt?: number;    // epoch ms
}
```

### LLM extraction prompt pattern
```typescript
const EXTRACTION_PROMPT = `Extract named entity facts from the transcript.
Return JSON array: [{entity, factType, value, confidence}]
Only concrete, verifiable facts. No inferences.`;
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/hooks/src/workers/entity-extractor.test.ts`**
```typescript
describe('EntityExtractorWorker', () => {
  it('extracts facts from a sample transcript via mock LLM', async () => {
    // Mock callLLM to return known JSON; verify EntityMemory.store() called
  });
  it('ignores short transcripts (<50 chars)', async () => { ... });
  it('does not throw on malformed LLM JSON response', async () => { ... });
});
```

**Unit — `v3/mcp/tools/entity-tools.test.ts`**
```typescript
describe('entity/get', () => {
  it('returns facts for known entity', async () => { ... });
  it('returns empty array for unknown entity', async () => { ... });
});
describe('entity/store', () => {
  it('stores a fact and retrieves it', async () => { ... });
  it('respects ttlMs expiry in subsequent get', async () => { ... });
});
```

**Integration:**
- Spawn a test agent run that produces transcript containing "uses jsonwebtoken"
- After `PostTask` hook fires, assert `entityMemory.retrieve('jsonwebtoken')` returns non-empty

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/hooks/src/workers/entity-extractor.ts` compiles
- [ ] `v3/@claude-flow/hooks/src/workers/entity-cleanup.ts` compiles
- [ ] `v3/mcp/tools/entity-tools.ts` compiles; tools registered in MCP tool list
- [ ] `pruneExpired()` added to `EntityMemory` in `tiers/entity.ts`
- [ ] `EntityExtractorWorker.register()` wires to `HookEvent.PostTask` (verified by test)
- [ ] `entity/get` and `entity/store` MCP tools return correct shapes
- [ ] All unit tests pass
- [ ] Integration test shows automatic extraction after a mocked agent run
- [ ] No `any` types in public API
