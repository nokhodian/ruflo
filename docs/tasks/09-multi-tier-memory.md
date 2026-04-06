# Task 09: Multi-Tier Memory Architecture
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Medium  
**Depends on:** None (foundational task)  
**Blocks:** Task 10 (Entity Memory), Task 11 (Episodic Memory)

---

## 1. Current State

Ruflo's memory system today is a single-tier HNSW vector store backed by AgentDB.

**Relevant files:**
- `v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB HNSW backend (primary store)
- `v3/@claude-flow/memory/src/hybrid-backend.ts` — HybridBackend composing SQLite + AgentDB
- `v3/@claude-flow/memory/src/sqlite-backend.ts` — SQLite fallback store
- `v3/@claude-flow/memory/src/types.ts` — `MemoryEntry`, `MemoryType` (`episodic | semantic | procedural | working | cache`), `IMemoryBackend`
- `v3/@claude-flow/memory/src/agent-memory-scope.ts` — per-agent namespace scoping
- `v3/@claude-flow/memory/src/index.ts` — package exports

**Existing `MemoryType`** (from `types.ts`):
```typescript
export type MemoryType =
  | 'episodic'    // Time-based experiences
  | 'semantic'    // Facts and concepts
  | 'procedural'  // How-to knowledge
  | 'working'     // Short-term operational
  | 'cache';      // Temporary data
```

**Gap:** All writes land in one HNSW partition regardless of lifecycle (short-term scratch vs. permanent learning vs. named-entity facts). There is no `TierManager` that routes reads/writes to the appropriate tier, no in-memory buffer tier, no entity KV store tier, and no contextual summary tier.

---

## 2. Gap Analysis

| Missing Capability | Effect |
|---|---|
| No in-memory short-term buffer | Every scratch write hits disk; fast agent scratchpad is impossible |
| No entity KV tier | Agents re-derive facts about the same files/APIs on every run |
| No contextual summary tier | Retrieval returns raw chunks; context windows bloat at 10k+ tokens |
| No `TierManager` router | Callers must manually choose storage layer |
| No flush-on-run-end lifecycle | Short-term memories never promoted to long-term |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/memory/src/tiers/short-term.ts` | In-memory buffer with configurable capacity cap; flush() promotes to long-term |
| `v3/@claude-flow/memory/src/tiers/entity.ts` | SQLite KV store for entity → fact mappings |
| `v3/@claude-flow/memory/src/tiers/contextual.ts` | Compressed HNSW partition for session summaries |
| `v3/@claude-flow/memory/src/tiers/index.ts` | Re-exports all tier classes |
| `v3/@claude-flow/memory/src/tier-manager.ts` | Routes reads/writes to correct tier based on `MemoryTier` tag |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/@claude-flow/memory/src/types.ts` | Add `MemoryTier` union type; add `tier` field to `MemoryEntry`; add `TierManagerConfig` interface | New routing metadata needed |
| `v3/@claude-flow/memory/src/index.ts` | Export `TierManager` and all tier classes | External consumers need access |
| `v3/@claude-flow/hooks/src/daemons/index.ts` | Add `MemoryFlushDaemon` that calls `ShortTermMemory.flush()` at session-end | Lifecycle hook for tier promotion |

---

## 5. Implementation Steps

**Step 1 — Add `MemoryTier` type and `tier` field to `types.ts`**

Read `v3/@claude-flow/memory/src/types.ts`, then add directly after the `MemoryType` definition:

```typescript
/** Which memory tier this entry belongs to */
export type MemoryTier =
  | 'short-term'   // In-memory buffer, current run only
  | 'long-term'    // Persistent HNSW, cross-run
  | 'entity'       // Named-entity KV facts
  | 'contextual';  // Compressed session summaries
```

Add `tier?: MemoryTier;` to the `MemoryEntry` interface after the `type` field.

Add to end of `types.ts`:
```typescript
export interface TierManagerConfig {
  shortTermCapacity: number;          // max entries before auto-flush (default: 500)
  entityStorePath: string;            // SQLite path for entity tier
  contextualNamespace: string;        // HNSW namespace for contextual tier
  autoFlushOnSessionEnd: boolean;     // default: true
}
```

**Step 2 — Create `v3/@claude-flow/memory/src/tiers/short-term.ts`**

```typescript
import { MemoryEntry, MemoryEntryInput } from '../types.js';

export class ShortTermMemory {
  private buffer: Map<string, MemoryEntry> = new Map();
  private readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = capacity;
  }

  store(entry: MemoryEntry): void {
    if (this.buffer.size >= this.capacity) {
      // Evict oldest entry (FIFO)
      const firstKey = this.buffer.keys().next().value;
      if (firstKey !== undefined) this.buffer.delete(firstKey);
    }
    this.buffer.set(entry.id, entry);
  }

  retrieve(id: string): MemoryEntry | undefined {
    return this.buffer.get(id);
  }

  search(query: string, limit = 10): MemoryEntry[] {
    // Simple substring search for short-term tier
    const results: MemoryEntry[] = [];
    for (const entry of this.buffer.values()) {
      if (entry.content.toLowerCase().includes(query.toLowerCase())) {
        results.push(entry);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  /** Promote all buffered entries to the provided long-term backend */
  async flush(longTermStore: { store(entry: MemoryEntryInput): Promise<string> }): Promise<number> {
    let promoted = 0;
    for (const entry of this.buffer.values()) {
      await longTermStore.store({ ...entry, tier: 'long-term' } as MemoryEntryInput);
      promoted++;
    }
    this.buffer.clear();
    return promoted;
  }

  clear(): void {
    this.buffer.clear();
  }

  get size(): number {
    return this.buffer.size;
  }
}
```

**Step 3 — Create `v3/@claude-flow/memory/src/tiers/entity.ts`**

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';

export interface EntityFact {
  entity: string;
  factType: string;
  value: string;
  confidence: number;
  sourceRunId: string;
  createdAt: number;
  expiresAt?: number;
}

export class EntityMemory {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_facts (
        entity      TEXT NOT NULL,
        fact_type   TEXT NOT NULL,
        value       TEXT NOT NULL,
        confidence  REAL NOT NULL DEFAULT 1.0,
        source_run_id TEXT,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER,
        PRIMARY KEY (entity, fact_type)
      );
      CREATE INDEX IF NOT EXISTS idx_entity ON entity_facts(entity);
      CREATE INDEX IF NOT EXISTS idx_fact_type ON entity_facts(fact_type);
    `);
  }

  store(fact: EntityFact): void {
    const stmt = this.db.prepare(`
      INSERT INTO entity_facts (entity, fact_type, value, confidence, source_run_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity, fact_type) DO UPDATE SET
        value = excluded.value,
        confidence = excluded.confidence,
        source_run_id = excluded.source_run_id,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `);
    stmt.run(
      fact.entity,
      fact.factType,
      fact.value,
      fact.confidence,
      fact.sourceRunId,
      fact.createdAt,
      fact.expiresAt ?? null
    );
  }

  retrieve(entity: string): EntityFact[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM entity_facts
      WHERE entity = ?
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY confidence DESC
    `).all(entity, now) as any[];
    return rows.map(this.rowToFact);
  }

  findByFactType(factType: string): EntityFact[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM entity_facts
      WHERE fact_type = ?
        AND (expires_at IS NULL OR expires_at > ?)
    `).all(factType, now) as any[];
    return rows.map(this.rowToFact);
  }

  delete(entity: string, factType?: string): number {
    if (factType) {
      const result = this.db.prepare(
        'DELETE FROM entity_facts WHERE entity = ? AND fact_type = ?'
      ).run(entity, factType);
      return result.changes;
    }
    const result = this.db.prepare(
      'DELETE FROM entity_facts WHERE entity = ?'
    ).run(entity);
    return result.changes;
  }

  private rowToFact(row: any): EntityFact {
    return {
      entity: row.entity,
      factType: row.fact_type,
      value: row.value,
      confidence: row.confidence,
      sourceRunId: row.source_run_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 4 — Create `v3/@claude-flow/memory/src/tiers/contextual.ts`**

```typescript
import type { IMemoryBackend, MemoryEntryInput } from '../types.js';

export interface SessionSummary {
  sessionId: string;
  agentSlugs: string[];
  summary: string;
  tokenCount: number;
  createdAt: number;
}

export class ContextualMemory {
  private readonly namespace: string;
  private summaries: Map<string, SessionSummary> = new Map();

  constructor(
    private readonly backend: IMemoryBackend,
    namespace = 'contextual-summaries'
  ) {
    this.namespace = namespace;
  }

  async storeSummary(summary: SessionSummary): Promise<void> {
    this.summaries.set(summary.sessionId, summary);
    const entry: MemoryEntryInput = {
      key: `summary:${summary.sessionId}`,
      content: summary.summary,
      type: 'episodic',
      namespace: this.namespace,
      tags: ['session-summary', ...summary.agentSlugs],
      metadata: {
        sessionId: summary.sessionId,
        agentSlugs: summary.agentSlugs,
        tokenCount: summary.tokenCount,
        tier: 'contextual',
      },
      accessLevel: 'swarm',
    };
    await this.backend.store(entry);
  }

  /** Return top-K session summaries relevant to the query, bounded by maxTokens */
  async retrieveContext(query: string, maxTokens = 2000): Promise<string> {
    const results = await this.backend.search(query, {
      limit: 10,
      namespace: this.namespace,
    });

    let totalTokens = 0;
    const parts: string[] = [];
    for (const r of results) {
      const tokens = Math.ceil(r.entry.content.length / 4); // rough estimate
      if (totalTokens + tokens > maxTokens) break;
      parts.push(r.entry.content);
      totalTokens += tokens;
    }
    return parts.join('\n\n---\n\n');
  }

  getSummary(sessionId: string): SessionSummary | undefined {
    return this.summaries.get(sessionId);
  }
}
```

**Step 5 — Create `v3/@claude-flow/memory/src/tiers/index.ts`**

```typescript
export { ShortTermMemory } from './short-term.js';
export { EntityMemory, type EntityFact } from './entity.js';
export { ContextualMemory, type SessionSummary } from './contextual.js';
```

**Step 6 — Create `v3/@claude-flow/memory/src/tier-manager.ts`**

```typescript
import { ShortTermMemory } from './tiers/short-term.js';
import { EntityMemory, type EntityFact } from './tiers/entity.js';
import { ContextualMemory, type SessionSummary } from './tiers/contextual.js';
import type {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryTier,
  TierManagerConfig,
} from './types.js';

export class TierManager {
  readonly shortTerm: ShortTermMemory;
  readonly entity: EntityMemory;
  readonly contextual: ContextualMemory;

  constructor(
    private readonly longTermBackend: IMemoryBackend,
    config: TierManagerConfig
  ) {
    this.shortTerm = new ShortTermMemory(config.shortTermCapacity);
    this.entity = new EntityMemory(config.entityStorePath);
    this.contextual = new ContextualMemory(longTermBackend, config.contextualNamespace);
  }

  /** Route a store call to the correct tier based on entry.tier */
  async store(input: MemoryEntryInput & { tier?: MemoryTier }): Promise<string> {
    const tier = input.tier ?? 'long-term';
    if (tier === 'short-term') {
      const entry = this.makeEntry(input);
      this.shortTerm.store(entry);
      return entry.id;
    }
    // entity and contextual have their own store helpers; long-term is the default
    return this.longTermBackend.store(input);
  }

  /** Route a search call across all tiers, merge and deduplicate results */
  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    const shortResults = this.shortTerm.search(query, limit);
    const longResults = await this.longTermBackend.search(query, { limit });
    const seen = new Set<string>();
    const merged: MemoryEntry[] = [];
    for (const e of [...shortResults, ...longResults.map(r => r.entry)]) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        merged.push(e);
      }
      if (merged.length >= limit) break;
    }
    return merged;
  }

  async flushShortTerm(): Promise<number> {
    return this.shortTerm.flush(this.longTermBackend);
  }

  private makeEntry(input: MemoryEntryInput): MemoryEntry {
    const now = Date.now();
    return {
      id: `st-${now}-${Math.random().toString(36).slice(2, 8)}`,
      key: input.key,
      content: input.content,
      type: input.type ?? 'working',
      namespace: input.namespace ?? 'default',
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      accessLevel: input.accessLevel ?? 'private',
      createdAt: now,
      updatedAt: now,
      version: 1,
      references: [],
    };
  }
}
```

**Step 7 — Update `v3/@claude-flow/memory/src/index.ts`** to export the new tier API:

Add after existing exports:
```typescript
export { TierManager } from './tier-manager.js';
export { ShortTermMemory, EntityMemory, ContextualMemory } from './tiers/index.js';
export type { EntityFact, SessionSummary, MemoryTier, TierManagerConfig } from './types.js';
```

---

## 6. Key Code Templates

### TierManagerConfig (add to `types.ts`)
```typescript
export interface TierManagerConfig {
  shortTermCapacity: number;       // default: 500
  entityStorePath: string;         // e.g. './data/memory/entities.db'
  contextualNamespace: string;     // default: 'contextual-summaries'
  autoFlushOnSessionEnd: boolean;  // default: true
}
```

### MemoryEntryInput extension (add `tier` field to existing interface in `types.ts`)
```typescript
// Add to existing MemoryEntryInput interface:
tier?: MemoryTier;
```

### Daemon integration hook (add to `v3/@claude-flow/hooks/src/daemons/index.ts`)
```typescript
import { TierManager } from '@claude-flow/memory';

export class MemoryFlushDaemon {
  constructor(private tierManager: TierManager) {}

  async onSessionEnd(): Promise<void> {
    const promoted = await this.tierManager.flushShortTerm();
    console.debug(`[MemoryFlushDaemon] Promoted ${promoted} entries to long-term`);
  }
}
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/memory/src/tiers/short-term.test.ts`**
```typescript
describe('ShortTermMemory', () => {
  it('stores and retrieves by id', () => { ... });
  it('evicts oldest entry when capacity exceeded', () => { ... });
  it('flush() clears buffer and returns count', async () => { ... });
  it('search() returns substring matches', () => { ... });
});
```

**Unit — `v3/@claude-flow/memory/src/tiers/entity.test.ts`**
```typescript
describe('EntityMemory', () => {
  it('stores a fact and retrieves it by entity', () => { ... });
  it('upserts on duplicate entity+fact_type', () => { ... });
  it('respects expiresAt TTL', () => { ... });
  it('deletes by entity and optional factType', () => { ... });
});
```

**Integration — `v3/@claude-flow/memory/src/tier-manager.test.ts`**
```typescript
describe('TierManager', () => {
  it('routes short-term tier to in-memory buffer', async () => { ... });
  it('routes long-term tier to HNSW backend', async () => { ... });
  it('search() merges short-term and long-term results', async () => { ... });
  it('flushShortTerm() promotes all buffered entries', async () => { ... });
});
```

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/memory/src/tiers/short-term.ts` exists and compiles with `tsc --noEmit`
- [ ] `v3/@claude-flow/memory/src/tiers/entity.ts` exists and compiles
- [ ] `v3/@claude-flow/memory/src/tiers/contextual.ts` exists and compiles
- [ ] `v3/@claude-flow/memory/src/tier-manager.ts` exists and compiles
- [ ] `MemoryTier` and `TierManagerConfig` added to `v3/@claude-flow/memory/src/types.ts`
- [ ] `TierManager` exported from `v3/@claude-flow/memory/src/index.ts`
- [ ] All unit tests pass (`npm test` in `v3/@claude-flow/memory/`)
- [ ] `ShortTermMemory.flush()` correctly populates the long-term backend in integration test
- [ ] `EntityMemory` SQLite schema created without error on fresh DB
- [ ] No `any` types introduced in public API surface
