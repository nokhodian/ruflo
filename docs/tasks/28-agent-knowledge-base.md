# Task 28: Per-Agent Knowledge Base with Pre-indexed Documents
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** Medium  
**Depends on:** none (can be implemented independently; integrates with HNSW in `v3/@claude-flow/memory/`)  
**Blocks:** none

## 1. Current State

Agents re-read the same large reference files on every invocation, wasting tokens and context window space.

| Component | Location | Current Behavior |
|---|---|---|
| Memory / HNSW | `v3/@claude-flow/memory/src/` | AgentDB with HNSW indexing exists; 150×–12,500× faster search |
| Document indexing | No implementation | No pre-indexing of project documentation or agent-specific references |
| Agent frontmatter | `.claude/agents/**/*.md` | `tools` field lists what the agent can use; no knowledge sources declared |
| Background workers | `v3/@claude-flow/hooks/src/workers/` | 12 workers exist; none dedicated to knowledge indexing |
| Shared partition | No implementation | No concept of a shared vs. agent-private knowledge partition |
| Context injection | `v3/mcp/tools/agent-tools.ts` | No automatic injection of relevant knowledge at spawn time |

**Concrete failure mode:** Every time the `engineering-security-engineer` is spawned, it uses Read tool calls to read `docs/threat-model.md` (8,000 tokens) and `docs/security-guidelines.md` (12,000 tokens). These files rarely change. Across 50 security review sessions per day, 1,000,000 tokens are spent re-reading unchanged reference documents. With pre-indexed HNSW retrieval, only the relevant 500-token excerpt would be injected.

## 2. Gap Analysis

- No `knowledge_sources` field in agent frontmatter — no declaration of which documents an agent relies on.
- No `KnowledgeWorker` background worker — no process that indexes declared documents.
- No HNSW partition scheme for `scope=shared` vs. `scope=<agent_slug>` — all memories are in one flat namespace.
- No `KnowledgeRetriever` that queries the correct partition(s) at spawn time and injects relevant excerpts.
- No incremental re-indexing — if a document changes, the stale HNSW index is not updated.
- No deduplication — same document could be indexed multiple times by different agents.

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/memory/src/knowledge/knowledge-store.ts` | HNSW partition management; handles `scope=shared` and `scope=<agent_slug>` partitions |
| `v3/@claude-flow/memory/src/knowledge/knowledge-retriever.ts` | Queries partitions for a given query; merges shared + private results; returns ranked excerpts |
| `v3/@claude-flow/memory/src/knowledge/document-chunker.ts` | Splits large documents into overlapping chunks for HNSW indexing |
| `v3/@claude-flow/hooks/src/workers/knowledge-worker.ts` | Background worker #13: indexes declared `knowledge_sources` for all agents at startup + on change |
| `v3/@claude-flow/cli/src/commands/knowledge.ts` | CLI commands: `knowledge index`, `knowledge search`, `knowledge status` |
| `tests/memory/knowledge-retriever.test.ts` | Unit tests for retrieval, partition isolation, and deduplication |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| All 230+ agent `.md` files (frontmatter) | Add `knowledge_sources` to `capability` block (see template below) | Declares per-agent document dependencies |
| `v3/mcp/tools/agent-tools.ts` | In spawn handler, call `KnowledgeRetriever.retrieveForTask(agentSlug, taskDescription)` and inject relevant excerpts into system prompt context | Every agent gets relevant knowledge injected at spawn |
| `v3/@claude-flow/memory/src/agent-db.ts` | Add `createKnowledgeTable()` migration; expose `getHNSWPartition(scope)` | Persistent metadata for indexed documents and partitions |
| `v3/@claude-flow/hooks/src/workers/` worker registry | Register `knowledge-worker` as worker #13 in the worker registry | Scheduled indexing |

## 5. Implementation Steps

1. **Define the schema** — Add the `knowledge_sources` block type to the agent frontmatter TypeScript schema. Define `KnowledgeSource`, `KnowledgeChunk`, and `KnowledgePartition` interfaces.

2. **Add `createKnowledgeTable()` migration** — In `agent-db.ts`, add a `knowledge_documents` table tracking: `doc_id`, `scope`, `file_path`, `content_hash`, `indexed_at`, `chunk_count`. Use `IF NOT EXISTS`.

3. **Build `DocumentChunker`** — In `document-chunker.ts`, split a text document into overlapping chunks:
   - Default chunk size: 800 tokens (~3200 characters).
   - Overlap: 100 tokens (~400 characters).
   - Returns `{ chunkId, docId, text, startChar, endChar }[]`.
   - Preserves paragraph boundaries when possible.

4. **Build `KnowledgeStore`** — In `knowledge-store.ts`:
   - `indexDocument(docPath, scope)`: reads the file, hashes content, checks if already indexed (by hash), chunks, embeds each chunk into the HNSW partition for `scope`.
   - `getPartitionNamespace(scope)`: returns the HNSW namespace string: `knowledge:shared` for shared, `knowledge:<agent_slug>` for private.
   - `documentNeedsReindex(docPath, scope)`: checks content hash against stored hash; returns true if changed.

5. **Build `KnowledgeRetriever`** — In `knowledge-retriever.ts`:
   - `retrieveForTask(agentSlug, query, maxChunks?)`: queries `knowledge:shared` namespace first (up to `maxChunks/2`), then `knowledge:<agentSlug>` (up to `maxChunks/2`).
   - Deduplicates by `chunkId`.
   - Ranks by HNSW similarity score.
   - Returns a formatted string of top-K excerpts with source document and line reference.

6. **Build `KnowledgeWorker`** — In `knowledge-worker.ts`, a `BackgroundWorker` subclass:
   - On worker start: parse all agent frontmatter files, collect `knowledge_sources`.
   - For each source, call `KnowledgeStore.indexDocument()` (skips if hash unchanged).
   - Set up a file watcher (via `fs.watch` or `chokidar`) for declared sources; re-index on change.
   - Priority: `low` (do not starve other workers).

7. **Wire into spawn handler** — In `agent-tools.ts`, before finalizing the system prompt, call `KnowledgeRetriever.retrieveForTask(agentSlug, taskDescription)`. If non-empty, format as a `## Relevant Knowledge` section and pass to `PromptAssembler` (Task 26) as a dedicated provider OR prepend directly.

8. **Build CLI commands** — In `commands/knowledge.ts`, implement `knowledge index [--agent <slug>]`, `knowledge search --query <q> --scope <shared|agent-slug>`, and `knowledge status`.

9. **Write tests** — Cover: chunker splits at paragraph boundary, knowledge store skips re-indexing unchanged files, retriever merges shared + private results without duplicates, retriever returns empty array for unknown agent slug.

## 6. Key Code Templates

```typescript
// Agent frontmatter knowledge_sources schema (TypeScript)

export interface KnowledgeSource {
  path: string;          // relative to project root
  scope: 'shared' | 'private'; // 'shared' = available to all agents; 'private' = this agent only
  refresh: 'startup' | 'on-change' | 'manual'; // re-indexing trigger
}

export interface AgentCapabilityKnowledge {
  knowledge_sources?: KnowledgeSource[];
}
```

```yaml
# Agent frontmatter example — engineering-security-engineer.md

capability:
  role: security-engineer
  knowledge_sources:
    shared:                                    # available to all agents
      - path: "docs/architecture.md"
        refresh: on-change
      - path: "docs/api-spec.yaml"
        refresh: on-change
    private:                                   # this agent only
      - path: "docs/security-guidelines.md"
        refresh: on-change
      - path: "docs/threat-model.md"
        refresh: on-change
      - path: "docs/owasp-checklist.md"
        refresh: manual
```

```typescript
// v3/@claude-flow/memory/src/knowledge/document-chunker.ts

export interface TextChunk {
  chunkId:    string;
  docId:      string;
  text:       string;
  startChar:  number;
  endChar:    number;
  chunkIndex: number;
}

const DEFAULT_CHUNK_SIZE_CHARS = 3200;   // ~800 tokens
const DEFAULT_OVERLAP_CHARS    = 400;    // ~100 tokens

export function chunkDocument(
  docId: string,
  text: string,
  chunkSizeChars = DEFAULT_CHUNK_SIZE_CHARS,
  overlapChars = DEFAULT_OVERLAP_CHARS
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = start + chunkSizeChars;

    if (end < text.length) {
      // Try to break at a paragraph boundary within 20% of chunk end
      const searchFrom = end - Math.floor(chunkSizeChars * 0.2);
      const searchTo   = Math.min(end + 200, text.length);
      const paraBreak  = text.lastIndexOf('\n\n', searchTo);
      if (paraBreak > searchFrom) end = paraBreak;
    } else {
      end = text.length;
    }

    chunks.push({
      chunkId:    `${docId}:${index}`,
      docId,
      text:       text.slice(start, end).trim(),
      startChar:  start,
      endChar:    end,
      chunkIndex: index,
    });

    start = end - overlapChars; // overlap
    index++;
  }

  return chunks;
}
```

```typescript
// v3/@claude-flow/memory/src/knowledge/knowledge-store.ts

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { chunkDocument, TextChunk } from './document-chunker.js';

export class KnowledgeStore {
  constructor(private agentDb: AgentDB) {}

  getPartitionNamespace(scope: string): string {
    return scope === 'shared' ? 'knowledge:shared' : `knowledge:${scope}`;
  }

  async documentNeedsReindex(filePath: string, scope: string): Promise<boolean> {
    if (!existsSync(filePath)) return false;
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    const existing = await this.agentDb.getKnowledgeDocMeta(filePath, scope);
    return !existing || existing.contentHash !== hash;
  }

  async indexDocument(filePath: string, scope: string): Promise<{ chunksIndexed: number }> {
    if (!existsSync(filePath)) {
      console.warn(`[KnowledgeStore] File not found: ${filePath}`);
      return { chunksIndexed: 0 };
    }

    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    const docId = `${scope}:${filePath}`;
    const namespace = this.getPartitionNamespace(scope);

    // Delete old chunks for this doc before re-indexing
    await this.agentDb.deleteKnowledgeChunks(docId, namespace);

    const chunks: TextChunk[] = chunkDocument(docId, content);

    for (const chunk of chunks) {
      await this.agentDb.storeWithEmbedding({
        namespace,
        key:   chunk.chunkId,
        value: chunk.text,
        metadata: {
          docId:      chunk.docId,
          filePath,
          scope,
          chunkIndex: chunk.chunkIndex,
          startChar:  chunk.startChar,
          endChar:    chunk.endChar,
        },
      });
    }

    await this.agentDb.setKnowledgeDocMeta(filePath, scope, {
      contentHash: hash,
      chunkCount:  chunks.length,
      indexedAt:   new Date(),
    });

    return { chunksIndexed: chunks.length };
  }

  async removeDocument(filePath: string, scope: string): Promise<void> {
    const docId    = `${scope}:${filePath}`;
    const namespace = this.getPartitionNamespace(scope);
    await this.agentDb.deleteKnowledgeChunks(docId, namespace);
    await this.agentDb.deleteKnowledgeDocMeta(filePath, scope);
  }
}
```

```typescript
// v3/@claude-flow/memory/src/knowledge/knowledge-retriever.ts

export interface KnowledgeExcerpt {
  chunkId:    string;
  filePath:   string;
  scope:      'shared' | string;
  text:       string;
  similarity: number;
  chunkIndex: number;
}

export interface RetrievalResult {
  excerpts:     KnowledgeExcerpt[];
  formattedContext: string;
}

export class KnowledgeRetriever {
  constructor(private agentDb: AgentDB, private store: KnowledgeStore) {}

  async retrieveForTask(
    agentSlug: string,
    query: string,
    maxChunks = 6
  ): Promise<RetrievalResult> {
    const perScope = Math.ceil(maxChunks / 2);

    // Query shared partition
    const sharedResults = await this.agentDb.semanticSearch(query, {
      namespace: this.store.getPartitionNamespace('shared'),
      limit: perScope,
      minScore: 0.65,
    });

    // Query agent-private partition
    const privateResults = await this.agentDb.semanticSearch(query, {
      namespace: this.store.getPartitionNamespace(agentSlug),
      limit: perScope,
      minScore: 0.65,
    });

    // Merge and deduplicate by chunkId
    const seen = new Set<string>();
    const all: KnowledgeExcerpt[] = [];
    for (const r of [...sharedResults, ...privateResults]) {
      const meta = r.metadata as Record<string, unknown>;
      const chunkId = String(r.key);
      if (!seen.has(chunkId)) {
        seen.add(chunkId);
        all.push({
          chunkId,
          filePath:   String(meta.filePath ?? 'unknown'),
          scope:      String(meta.scope ?? 'unknown'),
          text:       String(r.value),
          similarity: r.score ?? 0,
          chunkIndex: Number(meta.chunkIndex ?? 0),
        });
      }
    }

    // Sort by similarity descending, cap at maxChunks
    const top = all.sort((a, b) => b.similarity - a.similarity).slice(0, maxChunks);

    if (top.length === 0) {
      return { excerpts: [], formattedContext: '' };
    }

    const formattedContext = this.format(top);
    return { excerpts: top, formattedContext };
  }

  private format(excerpts: KnowledgeExcerpt[]): string {
    const header = `## Relevant Knowledge Base Excerpts\n\nThe following excerpts were retrieved from pre-indexed project documents.\n\n`;
    const body = excerpts.map((ex, i) =>
      `### Excerpt ${i + 1} — ${ex.filePath} (similarity: ${ex.similarity.toFixed(2)})\n\n${ex.text}`
    ).join('\n\n---\n\n');
    return header + body;
  }
}
```

```typescript
// v3/@claude-flow/hooks/src/workers/knowledge-worker.ts

import { BackgroundWorker } from '../background-worker.js';
import { KnowledgeStore } from '../../../@claude-flow/memory/src/knowledge/knowledge-store.js';
import { glob } from 'glob';
import { load as yamlLoad } from 'js-yaml';
import { readFileSync } from 'fs';

export class KnowledgeWorker extends BackgroundWorker {
  name     = 'knowledge';
  priority = 'low' as const;
  schedule = '0 2 * * *'; // daily at 2am, or on-demand

  constructor(private store: KnowledgeStore) { super(); }

  async run(): Promise<void> {
    const agentFiles = await glob('.claude/agents/**/*.md');
    let indexed = 0;
    let skipped = 0;

    for (const agentFile of agentFiles) {
      const frontmatter = this.extractFrontmatter(agentFile);
      if (!frontmatter?.capability?.knowledge_sources) continue;

      const sources = frontmatter.capability.knowledge_sources as Record<string, unknown[]>;

      // Index shared sources
      for (const src of (sources.shared ?? []) as Array<{ path: string }>) {
        if (await this.store.documentNeedsReindex(src.path, 'shared')) {
          await this.store.indexDocument(src.path, 'shared');
          indexed++;
        } else {
          skipped++;
        }
      }

      // Index private sources (scoped to agent slug)
      const agentSlug = frontmatter.name?.toLowerCase().replace(/\s+/g, '-') ?? agentFile;
      for (const src of (sources.private ?? []) as Array<{ path: string }>) {
        if (await this.store.documentNeedsReindex(src.path, agentSlug)) {
          await this.store.indexDocument(src.path, agentSlug);
          indexed++;
        } else {
          skipped++;
        }
      }
    }

    console.log(`[KnowledgeWorker] Indexed: ${indexed}, Skipped (unchanged): ${skipped}`);
  }

  private extractFrontmatter(filePath: string): Record<string, unknown> | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return null;
      return yamlLoad(match[1]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
```

### CLI Commands

```bash
# Index all agent knowledge sources
npx claude-flow@v3alpha knowledge index

# Index knowledge sources for a specific agent only
npx claude-flow@v3alpha knowledge index --agent engineering-security-engineer

# Search the knowledge base
npx claude-flow@v3alpha knowledge search --query "JWT authentication best practices" --scope shared
npx claude-flow@v3alpha knowledge search --query "CVE remediation" --scope engineering-security-engineer

# Show indexing status
npx claude-flow@v3alpha knowledge status
# Output:
# DOCUMENT                           SCOPE    CHUNKS  INDEXED_AT           HASH_CHANGED
# docs/architecture.md               shared   42      2026-04-06 02:00:00  no
# docs/security-guidelines.md        security 67      2026-04-06 02:00:00  no
# docs/threat-model.md               security 23      2026-04-05 02:00:00  YES — re-indexing needed
```

## 7. Testing Strategy

```typescript
// tests/memory/knowledge-retriever.test.ts
import { chunkDocument } from '../../v3/@claude-flow/memory/src/knowledge/document-chunker.js';
import { KnowledgeStore } from '../../v3/@claude-flow/memory/src/knowledge/knowledge-store.js';
import { KnowledgeRetriever } from '../../v3/@claude-flow/memory/src/knowledge/knowledge-retriever.js';

describe('chunkDocument()', () => {
  it('splits a short document into exactly one chunk', () => {
    const chunks = chunkDocument('doc1', 'Short text', 10000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Short text');
  });

  it('splits a long document into multiple overlapping chunks', () => {
    const text = 'A'.repeat(10000);
    const chunks = chunkDocument('doc1', text, 3200, 400);
    expect(chunks.length).toBeGreaterThan(2);
    // Overlap: chunk N+1 starts before chunk N ends
    expect(chunks[1].startChar).toBeLessThan(chunks[0].endChar);
  });

  it('assigns sequential chunkIndex values', () => {
    const chunks = chunkDocument('doc1', 'word '.repeat(1000), 500);
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('sets unique chunkIds in doc:index format', () => {
    const chunks = chunkDocument('my-doc', 'some text');
    expect(chunks[0].chunkId).toBe('my-doc:0');
  });
});

describe('KnowledgeStore', () => {
  it('skips re-indexing when file content hash is unchanged', async () => {
    // Mock agentDb with in-memory hash tracking
    const db = createMockAgentDb();
    const store = new KnowledgeStore(db);

    // First index
    await store.indexDocument('/tmp/test.md', 'shared');
    const callCount1 = db.storeWithEmbedding.mock.calls.length;

    // Second index — same content
    await store.indexDocument('/tmp/test.md', 'shared');
    // documentNeedsReindex should return false → no new calls
    expect(db.storeWithEmbedding.mock.calls.length).toBe(callCount1);
  });
});

describe('KnowledgeRetriever', () => {
  it('merges shared and private results without duplicates', async () => {
    const mockDb = createMockAgentDbWithSearchResults([
      { key: 'chunk:1', value: 'shared content', score: 0.9, metadata: { filePath: 'a.md', scope: 'shared', chunkIndex: 0 } },
      { key: 'chunk:1', value: 'shared content', score: 0.9, metadata: { filePath: 'a.md', scope: 'shared', chunkIndex: 0 } }, // duplicate
      { key: 'chunk:2', value: 'private content', score: 0.8, metadata: { filePath: 'b.md', scope: 'agent-slug', chunkIndex: 0 } },
    ]);
    const store = new KnowledgeStore(mockDb);
    const retriever = new KnowledgeRetriever(mockDb, store);
    const result = await retriever.retrieveForTask('agent-slug', 'security');
    expect(result.excerpts).toHaveLength(2); // not 3 — duplicate removed
  });

  it('returns empty result for unknown agent with no knowledge', async () => {
    const mockDb = createMockAgentDbWithSearchResults([]);
    const store = new KnowledgeStore(mockDb);
    const retriever = new KnowledgeRetriever(mockDb, store);
    const result = await retriever.retrieveForTask('unknown-agent', 'any query');
    expect(result.excerpts).toHaveLength(0);
    expect(result.formattedContext).toBe('');
  });
});
```

## 8. Definition of Done

- [ ] `knowledge_sources` field parseable from agent frontmatter YAML with `shared` and `private` sub-keys
- [ ] `DocumentChunker` splits documents at paragraph boundaries; overlap of ~100 tokens
- [ ] `DocumentChunker` assigns `chunkId` in `docId:index` format
- [ ] `KnowledgeStore.documentNeedsReindex()` returns `false` when file content hash is unchanged
- [ ] `KnowledgeStore.indexDocument()` deletes old chunks before re-indexing
- [ ] `KnowledgeRetriever.retrieveForTask()` queries both shared and private partitions
- [ ] `KnowledgeRetriever` deduplicates results by `chunkId`
- [ ] `KnowledgeWorker` skips unchanged files and logs count of indexed vs. skipped
- [ ] Spawn handler in `agent-tools.ts` calls `KnowledgeRetriever.retrieveForTask()` and injects excerpts as a `## Relevant Knowledge Base Excerpts` section
- [ ] `knowledge index` CLI command indexes all declared sources
- [ ] `knowledge status` CLI command shows per-document hash-change status
- [ ] At least 3 representative agent files updated with `knowledge_sources` frontmatter
- [ ] All unit tests pass using in-memory mock AgentDB; no real file I/O required for tests
- [ ] `tsc --noEmit` passes across all new and modified files
