# Task 11: Episodic Memory with Temporal Binning
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Medium  
**Depends on:** Task 09 (Multi-Tier Memory — `ContextualMemory` and `TierManager` must exist)  
**Blocks:** None

---

## 1. Current State

`v3/@claude-flow/memory/src/types.ts` defines `MemoryType = 'episodic' | ...` but treats episodic entries identically to all other types — raw HNSW chunks with no episode boundary, no summary compression, and no temporal grouping.

**Relevant files:**
- `v3/@claude-flow/memory/src/types.ts` — `MemoryEntry`, `MemoryType`; `MemoryType.episodic` exists but is unrestricted
- `v3/@claude-flow/memory/src/tiers/contextual.ts` — `ContextualMemory`, `SessionSummary` (created in Task 09)
- `v3/@claude-flow/memory/src/tier-manager.ts` — `TierManager` with short/entity/contextual tiers (Task 09)
- `v3/@claude-flow/memory/src/hybrid-backend.ts` — current primary read/write path
- `v3/@claude-flow/hooks/src/types.ts` — `HookEvent.PostTask`, `HookEvent.SessionEnd`
- `v3/@claude-flow/hooks/src/registry/index.ts` — `registerHook`
- `v3/mcp/tools/memory-tools.ts` — existing `memory/store`, `memory/retrieve`, `memory/search` MCP tools

**What is missing:** No `Episode` data type, no boundary detection, no run-level grouping, no summary generation on episode close, and no retrieval API that returns ranked episodes instead of raw chunks.

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No `Episode` model or table | Memories are ungrouped chunks; temporal context is lost |
| No episode boundary detection | No way to say "this session was one coherent work unit" |
| No per-episode LLM summarization | Retrievals return 10+ raw chunks instead of one coherent summary |
| No `maxEpisodes` retrieval cap | Context windows bloat when agents load all past work |
| No `episodic/search` MCP tool | Agents cannot query episodic memory via MCP |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/memory/src/episodic-store.ts` | `EpisodicStore` class: manages `Episode` lifecycle; persists to SQLite; summarizes via LLM on close |
| `v3/@claude-flow/hooks/src/workers/episode-binner.ts` | Hook worker that closes the current episode on `SessionEnd` / `PostTask` run boundary |
| `v3/mcp/tools/episodic-tools.ts` | MCP tools: `episodic/search`, `episodic/get`, `episodic/list` |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/@claude-flow/memory/src/types.ts` | Add `Episode` interface; add `EpisodicStoreConfig` interface | New data models |
| `v3/@claude-flow/memory/src/tier-manager.ts` | Add `episodic` property; route `MemoryTier='episodic'` stores to `EpisodicStore` | Unified tier routing |
| `v3/@claude-flow/memory/src/index.ts` | Export `EpisodicStore` and `Episode` | External access |
| `v3/@claude-flow/hooks/src/workers/index.ts` | Export `EpisodeBinnerWorker` | Worker registry |
| `v3/mcp/tools/index.ts` | Add `episodicTools` to exported tool list | MCP registration |

---

## 5. Implementation Steps

**Step 1 — Add `Episode` and `EpisodicStoreConfig` to `types.ts`**

```typescript
export interface Episode {
  episodeId: string;
  sessionId: string;
  runIds: string[];          // IDs of all runs in this episode
  summary: string;           // LLM-compressed summary of the episode
  startedAt: number;         // epoch ms
  endedAt: number;           // epoch ms
  agentSlugs: string[];
  taskTypes: string[];
  tokenEstimate: number;     // rough token count of raw content
}

export interface EpisodicStoreConfig {
  dbPath: string;            // SQLite path, e.g. './data/memory/episodes.db'
  maxRunsPerEpisode: number; // close episode after this many runs (default: 20)
  summaryModel: string;      // model for compression (default: 'claude-haiku-4-5')
}
```

**Step 2 — Create `v3/@claude-flow/memory/src/episodic-store.ts`**

```typescript
import Database from 'better-sqlite3';
import type { Episode, EpisodicStoreConfig } from './types.js';

async function summarizeWithLLM(content: string, model: string): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const msg = await client.messages.create({
    model,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Summarize this agent session in 3-5 sentences, focusing on decisions made and outputs produced:\n\n${content.slice(0, 8000)}`,
    }],
  });
  const block = msg.content[0];
  return block.type === 'text' ? block.text : content.slice(0, 500);
}

export class EpisodicStore {
  private db: Database.Database;
  private currentEpisode: Partial<Episode> | null = null;
  private rawContent: string[] = [];

  constructor(private config: EpisodicStoreConfig) {
    this.db = new Database(config.dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        episode_id    TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        run_ids       TEXT NOT NULL,  -- JSON array
        summary       TEXT NOT NULL,
        started_at    INTEGER NOT NULL,
        ended_at      INTEGER NOT NULL,
        agent_slugs   TEXT NOT NULL,  -- JSON array
        task_types    TEXT NOT NULL,  -- JSON array
        token_estimate INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_session ON episodes(session_id);
      CREATE INDEX IF NOT EXISTS idx_started ON episodes(started_at);
    `);
  }

  /** Start accumulating a new episode (or extend the current one) */
  addRun(runId: string, agentSlug: string, taskType: string, content: string): void {
    const now = Date.now();

    if (!this.currentEpisode) {
      this.currentEpisode = {
        episodeId: `ep-${now}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: runId.split('-')[0] ?? 'unknown',
        runIds: [],
        agentSlugs: [],
        taskTypes: [],
        startedAt: now,
        tokenEstimate: 0,
      };
    }

    this.currentEpisode.runIds!.push(runId);
    if (!this.currentEpisode.agentSlugs!.includes(agentSlug)) {
      this.currentEpisode.agentSlugs!.push(agentSlug);
    }
    if (!this.currentEpisode.taskTypes!.includes(taskType)) {
      this.currentEpisode.taskTypes!.push(taskType);
    }
    this.currentEpisode.tokenEstimate = (this.currentEpisode.tokenEstimate ?? 0) + Math.ceil(content.length / 4);
    this.rawContent.push(content);

    // Auto-close when run count exceeds threshold
    if (this.currentEpisode.runIds!.length >= this.config.maxRunsPerEpisode) {
      void this.closeEpisode();
    }
  }

  /** Close and persist the current episode with LLM summary */
  async closeEpisode(): Promise<Episode | null> {
    if (!this.currentEpisode) return null;

    const ep = this.currentEpisode;
    ep.endedAt = Date.now();

    const combined = this.rawContent.join('\n\n---\n\n');
    try {
      ep.summary = await summarizeWithLLM(combined, this.config.summaryModel);
    } catch {
      ep.summary = combined.slice(0, 500) + '...';
    }

    const episode = ep as Episode;
    this.persistEpisode(episode);
    this.currentEpisode = null;
    this.rawContent = [];

    return episode;
  }

  private persistEpisode(ep: Episode): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO episodes
        (episode_id, session_id, run_ids, summary, started_at, ended_at, agent_slugs, task_types, token_estimate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ep.episodeId,
      ep.sessionId,
      JSON.stringify(ep.runIds),
      ep.summary,
      ep.startedAt,
      ep.endedAt,
      JSON.stringify(ep.agentSlugs),
      JSON.stringify(ep.taskTypes),
      ep.tokenEstimate
    );
  }

  /** Simple keyword search across episode summaries */
  search(query: string, maxEpisodes = 5): Episode[] {
    const rows = this.db.prepare(`
      SELECT * FROM episodes
      WHERE summary LIKE ?
      ORDER BY ended_at DESC
      LIMIT ?
    `).all(`%${query}%`, maxEpisodes) as any[];
    return rows.map(this.rowToEpisode);
  }

  getById(episodeId: string): Episode | undefined {
    const row = this.db.prepare(
      'SELECT * FROM episodes WHERE episode_id = ?'
    ).get(episodeId) as any;
    return row ? this.rowToEpisode(row) : undefined;
  }

  listBySession(sessionId: string): Episode[] {
    const rows = this.db.prepare(
      'SELECT * FROM episodes WHERE session_id = ? ORDER BY started_at ASC'
    ).all(sessionId) as any[];
    return rows.map(this.rowToEpisode);
  }

  private rowToEpisode(row: any): Episode {
    return {
      episodeId: row.episode_id,
      sessionId: row.session_id,
      runIds: JSON.parse(row.run_ids),
      summary: row.summary,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      agentSlugs: JSON.parse(row.agent_slugs),
      taskTypes: JSON.parse(row.task_types),
      tokenEstimate: row.token_estimate,
    };
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 3 — Create `v3/@claude-flow/hooks/src/workers/episode-binner.ts`**

```typescript
import { registerHook } from '../registry/index.js';
import { HookEvent, HookPriority, type HookContext } from '../types.js';
import { EpisodicStore } from '@claude-flow/memory';

export class EpisodeBinnerWorker {
  constructor(private store: EpisodicStore) {}

  register(): void {
    // On each completed task, add the run to the current episode
    registerHook({
      event: HookEvent.PostTask,
      priority: HookPriority.Background,
      handler: async (ctx: HookContext) => {
        const taskId     = (ctx.data?.taskId as string)     ?? `task-${Date.now()}`;
        const agentSlug  = (ctx.data?.agentSlug as string)  ?? 'unknown';
        const taskType   = (ctx.data?.taskType as string)   ?? 'general';
        const transcript = (ctx.data?.transcript as string) ?? '';

        this.store.addRun(taskId, agentSlug, taskType, transcript);
        return { success: true };
      },
    });

    // On session end, close and persist the episode
    registerHook({
      event: HookEvent.SessionEnd,
      priority: HookPriority.Background,
      handler: async (_ctx: HookContext) => {
        const episode = await this.store.closeEpisode();
        return {
          success: true,
          metadata: episode ? { closedEpisodeId: episode.episodeId } : {},
        };
      },
    });
  }
}
```

**Step 4 — Create `v3/mcp/tools/episodic-tools.ts`**

```typescript
import { z } from 'zod';
import { MCPTool } from '../types.js';
import { EpisodicStore } from '@claude-flow/memory';

let _episodicStore: EpisodicStore | null = null;
export function setEpisodicStore(store: EpisodicStore): void { _episodicStore = store; }

function getStore(): EpisodicStore {
  if (!_episodicStore) throw new Error('EpisodicStore not initialized');
  return _episodicStore;
}

export const episodicSearchTool: MCPTool = {
  name: 'episodic/search',
  description: 'Search past session episodes by keyword; returns summaries, not raw chunks',
  inputSchema: {
    type: 'object',
    properties: {
      query:       { type: 'string', description: 'Search keywords' },
      maxEpisodes: { type: 'number', description: 'Max episodes to return (default 5)', default: 5 },
    },
    required: ['query'],
  },
  handler: async (input) => {
    const schema = z.object({ query: z.string(), maxEpisodes: z.number().default(5) });
    const { query, maxEpisodes } = schema.parse(input);
    const episodes = getStore().search(query, maxEpisodes);
    return { episodes, count: episodes.length };
  },
  category: 'memory',
  tags: ['memory', 'episodic', 'search'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

export const episodicGetTool: MCPTool = {
  name: 'episodic/get',
  description: 'Get a specific episode by ID',
  inputSchema: {
    type: 'object',
    properties: {
      episodeId: { type: 'string' },
    },
    required: ['episodeId'],
  },
  handler: async (input) => {
    const { episodeId } = z.object({ episodeId: z.string() }).parse(input);
    const episode = getStore().getById(episodeId);
    if (!episode) throw new Error(`Episode not found: ${episodeId}`);
    return episode;
  },
  category: 'memory',
  tags: ['memory', 'episodic'],
  version: '1.0.0',
};

export const episodicListTool: MCPTool = {
  name: 'episodic/list',
  description: 'List all episodes for a given session ID',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
    },
    required: ['sessionId'],
  },
  handler: async (input) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(input);
    const episodes = getStore().listBySession(sessionId);
    return { episodes, count: episodes.length };
  },
  category: 'memory',
  tags: ['memory', 'episodic', 'list'],
  version: '1.0.0',
};

export const episodicTools: MCPTool[] = [
  episodicSearchTool,
  episodicGetTool,
  episodicListTool,
];
export default episodicTools;
```

**Step 5 — Update `v3/@claude-flow/memory/src/index.ts`**

Add:
```typescript
export { EpisodicStore } from './episodic-store.js';
export type { Episode, EpisodicStoreConfig } from './types.js';
```

**Step 6 — Update `v3/@claude-flow/hooks/src/workers/index.ts`**

Add:
```typescript
export { EpisodeBinnerWorker } from './episode-binner.js';
```

**Step 7 — Update `v3/mcp/tools/index.ts`**

Add `episodicTools` to the exported array.

---

## 6. Key Code Templates

### Episode interface (summary of what goes in `types.ts`)
```typescript
export interface Episode {
  episodeId: string;
  sessionId: string;
  runIds: string[];
  summary: string;
  startedAt: number;   // epoch ms
  endedAt: number;
  agentSlugs: string[];
  taskTypes: string[];
  tokenEstimate: number;
}
```

### Wiring in daemon startup
```typescript
import { EpisodicStore } from '@claude-flow/memory';
import { EpisodeBinnerWorker } from '../workers/index.js';

const episodicStore = new EpisodicStore({
  dbPath: process.env.EPISODIC_DB_PATH ?? './data/memory/episodes.db',
  maxRunsPerEpisode: 20,
  summaryModel: 'claude-haiku-4-5',
});
new EpisodeBinnerWorker(episodicStore).register();
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/memory/src/episodic-store.test.ts`**
```typescript
describe('EpisodicStore', () => {
  it('accumulates runs into a single episode', () => { ... });
  it('auto-closes episode when maxRunsPerEpisode reached', async () => { ... });
  it('persists episode to SQLite and retrieves by id', async () => { ... });
  it('search() returns episodes with matching summary text', () => { ... });
  it('listBySession() returns episodes in startedAt order', () => { ... });
});
```

**Unit — `v3/mcp/tools/episodic-tools.test.ts`**
```typescript
describe('episodic/search', () => {
  it('returns episodes matching keyword', async () => { ... });
  it('respects maxEpisodes parameter', async () => { ... });
});
```

**Integration:**
- Fire 5 `PostTask` hook events with transcript data
- Fire `SessionEnd`
- Assert `EpisodicStore.listBySession()` returns 1 episode with all 5 runIds
- Assert episode summary is non-empty string

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/memory/src/episodic-store.ts` exists and compiles
- [ ] `Episode` and `EpisodicStoreConfig` interfaces added to `types.ts`
- [ ] `EpisodicStore` exported from `v3/@claude-flow/memory/src/index.ts`
- [ ] `EpisodeBinnerWorker` registered and fires on `PostTask` and `SessionEnd`
- [ ] Three MCP tools (`episodic/search`, `episodic/get`, `episodic/list`) registered
- [ ] Unit tests pass for `EpisodicStore`
- [ ] Integration test confirms episode closes and persists on session end
- [ ] `episodic/search` returns `{ episodes: Episode[], count: number }` shape
- [ ] No `any` types in public API surface
