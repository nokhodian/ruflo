# Task 47: Dynamic Agent Synthesis (AutoBuild)

**Priority:** Phase 5 — Future
**Effort:** High
**Depends on:** Task 46 (Agent Sandboxing — synthesized agents MUST run in Docker/WASM sandbox because their code is LLM-generated and untrusted)
**Blocks:** (none)

---

## 1. Current State

Ruflo has 230+ agent types hardcoded in `ALLOWED_AGENT_TYPES` in `v3/mcp/tools/agent-tools.ts`. When no agent scores above the HNSW similarity threshold for a given task, the system falls back to a generic agent or fails. There is no mechanism to create agents on demand.

Relevant files:

- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `ALLOWED_AGENT_TYPES` (line 33, 138 entries). `agentTypeSchema` validates against this fixed list (line 142). No dynamic registration exists.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/index.ts` — background worker registry; no `SynthesisWorker`.
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/` — agent definitions directory; no `ephemeral/` subdirectory.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB backend; no TTL support on stored entries.
- No `synthesis-prompt-template` file exists anywhere in the codebase.

---

## 2. Gap Analysis

**What is missing:**

1. No `SynthesisWorker` — no background worker that detects capability gaps and triggers agent synthesis.
2. No synthesis prompt template — no structured prompt for asking Claude to generate a new agent definition.
3. No `AgentDefinition` schema for LLM-structured output — synthesis cannot produce validated agent files.
4. No TTL mechanism on AgentDB entries — ephemeral agents would persist forever without cleanup.
5. No `.claude/agents/ephemeral/` directory creation — synthesized agents have no storage location.
6. No HNSW gap detection — the trigger condition (no agent above similarity threshold) is not implemented.
7. `agentTypeSchema` rejects unknown agent types — dynamically synthesized agents cannot be spawned until registered.
8. No promotion pathway — a successful ephemeral agent cannot be promoted to a permanent agent type.

**Concrete failure modes:**

- A task requiring "Kubernetes Helm chart reviewer" finds no match above 0.72 HNSW threshold. Instead of synthesizing a specialist, the system falls back to `researcher`, which produces generic unhelpful output.
- Without TTL, `.claude/agents/ephemeral/` accumulates hundreds of one-use agent files, polluting the agent registry and slowing HNSW indexing.
- An LLM-synthesized agent with `Bash` tool access runs on the host without sandboxing (Task 46 must be completed first).
- A synthesized agent's generated system prompt contains a prompt injection that causes it to exfiltrate data — catastrophic without sandbox isolation.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/workers/synthesis-worker.ts` | `SynthesisWorker` — background worker: detects gaps, calls synthesis, writes ephemeral agents |
| `v3/@claude-flow/hooks/src/synthesis/synthesis-prompt-template.ts` | Synthesis prompt template builder + `AgentDefinition` structured output schema |
| `v3/@claude-flow/hooks/src/synthesis/ttl-cleanup.ts` | TTL cleanup — removes expired ephemeral agent files and AgentDB entries |
| `v3/@claude-flow/hooks/src/synthesis/ephemeral-registry.ts` | Tracks ephemeral agents with metadata: created, expires, usage count, quality |
| `v3/@claude-flow/hooks/src/synthesis/agent-promoter.ts` | Promotes an ephemeral agent to permanent status after quality threshold reached |
| `v3/@claude-flow/hooks/src/synthesis/types.ts` | `AgentDefinition`, `SynthesisRequest`, `EphemeralAgentRecord` types |
| `v3/@claude-flow/hooks/src/synthesis/index.ts` | Barrel export |
| `v3/@claude-flow/hooks/src/__tests__/synthesis.test.ts` | Unit tests |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `v3/mcp/tools/agent-tools.ts` | Modify `agentTypeSchema` to also accept agent types registered in `EphemeralRegistry.list()` (dynamic whitelist alongside static `ALLOWED_AGENT_TYPES`). |
| `v3/@claude-flow/hooks/src/workers/index.ts` | Register `SynthesisWorker` as a background worker with `priority: 'normal'` and `trigger: 'on-demand'` (triggered when HNSW gap is detected, not on a schedule). |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `storeWithTTL(key: string, value: unknown, ttlMs: number)` and `deleteExpired(namespace: string)` methods. |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Add `agent synth --task "<description>"` subcommand to manually trigger synthesis. Add `agent ephemeral list` to show TTL countdowns. Add `agent promote --agent-slug <slug>` to promote ephemeral → permanent. |

---

## 5. Implementation Steps

**Step 1 — Define synthesis types**

Create `v3/@claude-flow/hooks/src/synthesis/types.ts`:

```typescript
export interface AgentDefinition {
  slug: string;                   // kebab-case, matches agent file name
  name: string;                   // human-readable name
  description: string;
  color: string;                  // hex or named color
  emoji: string;
  vibe: string;                   // one-sentence personality description
  tools: string[];                // subset of: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
  systemPromptBody: string;       // full markdown system prompt
  capability?: {
    sandbox: 'docker' | 'wasm' | 'none';
    planning_step?: 'required' | 'optional' | 'disabled';
    confidence_threshold?: number;
  };
  tags: string[];
  synthesizedFrom: string;        // original task description that triggered synthesis
  synthesizedAt: Date;
}

export interface SynthesisRequest {
  requestId: string;
  taskDescription: string;
  topMatchSlug: string;           // best existing agent (below threshold)
  topMatchScore: number;
  existingAgentCount: number;
  requestedAt: Date;
}

export interface EphemeralAgentRecord {
  slug: string;
  filePath: string;
  createdAt: Date;
  expiresAt: Date;
  usageCount: number;
  avgQualityScore: number;
  promoted: boolean;
  synthesisRequestId: string;
}
```

**Step 2 — Build synthesis prompt template**

Create `v3/@claude-flow/hooks/src/synthesis/synthesis-prompt-template.ts`. See Key Code Templates — this is the authoritative synthesis prompt template.

**Step 3 — Build TTL cleanup**

Create `v3/@claude-flow/hooks/src/synthesis/ttl-cleanup.ts`. See Key Code Templates.

**Step 4 — Build ephemeral registry**

Create `v3/@claude-flow/hooks/src/synthesis/ephemeral-registry.ts`. See Key Code Templates.

**Step 5 — Build SynthesisWorker**

Create `v3/@claude-flow/hooks/src/workers/synthesis-worker.ts`. See Key Code Templates.

**Step 6 — Modify `agentTypeSchema` to accept ephemeral agents**

Edit `v3/mcp/tools/agent-tools.ts`. Change `agentTypeSchema` (line 142) to:

```typescript
const agentTypeSchema = z.enum(ALLOWED_AGENT_TYPES).or(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
    .max(64)
    .refine(
      async (slug) => {
        // Accept known static types or registered ephemeral types
        return ALLOWED_AGENT_TYPES.includes(slug as any)
          || (await EphemeralRegistry.isRegistered(slug));
      },
      { message: 'Unknown agent type — not in ALLOWED_AGENT_TYPES or ephemeral registry' }
    )
);
```

**Step 7 — Add AgentDB TTL support**

Edit `v3/@claude-flow/memory/src/agentdb-backend.ts`. Add:

```typescript
async storeWithTTL(key: string, value: unknown, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await this.store(key, { value, expiresAt: expiresAt.toISOString() });
}

async deleteExpired(namespace: string): Promise<number> {
  const keys = await this.listKeys(`${namespace}:`);
  const now = new Date();
  let deleted = 0;
  for (const key of keys) {
    const entry = await this.retrieve(key) as { value: unknown; expiresAt: string } | null;
    if (entry?.expiresAt && new Date(entry.expiresAt) <= now) {
      await this.delete(key);
      deleted++;
    }
  }
  return deleted;
}
```

**Step 8 — CLI subcommands**

Edit `v3/@claude-flow/cli/src/commands/agent.ts`. Add three subcommands:

1. `agent synth --task "<text>" [--dry-run]` — trigger synthesis manually
2. `agent ephemeral list` — show active ephemeral agents with TTL countdowns
3. `agent promote --slug <slug>` — copy ephemeral agent to `.claude/agents/` and add to ALLOWED_AGENT_TYPES

**Step 9 — Write tests**

Create `v3/@claude-flow/hooks/src/__tests__/synthesis.test.ts`. See Testing Strategy.

---

## 6. Key Code Templates

### `synthesis-prompt-template.ts` — THE SYNTHESIS PROMPT TEMPLATE

```typescript
import { z } from 'zod';
import type { AgentDefinition, SynthesisRequest } from './types.js';

// Zod schema for structured output from Claude during synthesis
export const agentDefinitionSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/, 'Slug must be lowercase kebab-case, 3-63 chars'),
  name: z.string().min(5).max(80),
  description: z.string().min(20).max(300),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$|^[a-z]+$/, 'Must be hex color or CSS color name'),
  emoji: z.string().length(2).or(z.string().length(1)),
  vibe: z.string().min(10).max(150),
  tools: z.array(z.enum(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']))
    .min(1).max(8),
  systemPromptBody: z.string().min(200).max(8000),
  capability: z.object({
    sandbox: z.enum(['docker', 'wasm', 'none']).default('docker'),
    planning_step: z.enum(['required', 'optional', 'disabled']).default('required'),
    confidence_threshold: z.number().min(0).max(1).default(0.75),
  }).optional(),
  tags: z.array(z.string().min(2).max(30)).min(1).max(10),
  synthesizedFrom: z.string(),
  synthesizedAt: z.string().datetime(),
});

export class SynthesisPromptTemplate {
  /**
   * Builds the synthesis prompt.
   * This is the authoritative template — modifying this changes the behavior of all
   * dynamically generated agents.
   */
  static build(request: SynthesisRequest, existingAgentSlugs: string[]): string {
    const agentList = existingAgentSlugs.slice(0, 50).join(', ');

    return `You are an expert AI agent designer. Your task is to create a new specialist agent definition.

## Context

A user task could not be matched to any existing agent with sufficient confidence.

**Task that triggered synthesis:**
"${request.taskDescription}"

**Best existing match:** \`${request.topMatchSlug}\` (similarity score: ${request.topMatchScore.toFixed(3)} — below threshold 0.72)

**Total existing agents:** ${request.existingAgentCount}

**Sample existing agents:** ${agentList}

## Your Mission

Design a new specialist agent that fills this capability gap. The agent must be genuinely different from existing agents — not a minor variation.

## Output Format

Output ONLY a valid JSON object matching this exact schema. No explanation. No markdown code blocks. Just the raw JSON.

\`\`\`
{
  "slug": "lowercase-kebab-case-3-to-63-chars",
  "name": "Human-Readable Agent Name (5-80 chars)",
  "description": "What this agent does, 20-300 chars",
  "color": "#hexcolor or CSS color name",
  "emoji": "single emoji character",
  "vibe": "One-sentence personality (10-150 chars)",
  "tools": ["subset of: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch"],
  "systemPromptBody": "Full markdown system prompt body, 200-8000 chars. Include: identity, core mission, critical rules, communication style, success metrics.",
  "capability": {
    "sandbox": "docker",
    "planning_step": "required",
    "confidence_threshold": 0.75
  },
  "tags": ["tag1", "tag2"],
  "synthesizedFrom": "${request.taskDescription.replace(/"/g, '\\"')}",
  "synthesizedAt": "${new Date().toISOString()}"
}
\`\`\`

## Quality Requirements

1. The \`systemPromptBody\` MUST be a complete, usable system prompt — not a placeholder.
2. Include concrete domain expertise in the prompt (specific tools, frameworks, standards).
3. The \`sandbox\` MUST be "docker" unless the agent needs no shell access.
4. The \`slug\` MUST NOT conflict with any of these existing slugs: ${agentList}
5. Do not create a generic agent — this must be a true specialist.`;
  }

  /**
   * Converts a validated AgentDefinition to the .md file format
   * used in .claude/agents/ephemeral/
   */
  static toAgentMarkdown(def: AgentDefinition): string {
    const toolsList = def.tools.join(', ');
    const sandboxBlock = def.capability?.sandbox && def.capability.sandbox !== 'none'
      ? `  sandbox: ${def.capability.sandbox}\n  sandbox_config:\n    image: "node:20-alpine"\n    network: none\n    cpu_limit: "0.5"\n    memory_limit: "512m"`
      : '  sandbox: none';

    return `---
name: ${def.name}
description: ${def.description}
color: ${def.color}
emoji: ${def.emoji}
vibe: ${def.vibe}
tools: ${toolsList}
synthesized: true
synthesized_from: "${def.synthesizedFrom.replace(/"/g, '\\"')}"
synthesized_at: ${def.synthesizedAt.toISOString()}
tags: [${def.tags.map(t => `"${t}"`).join(', ')}]
capability:
  planning_step: ${def.capability?.planning_step ?? 'required'}
  confidence_threshold: ${def.capability?.confidence_threshold ?? 0.75}
${sandboxBlock}
---

${def.systemPromptBody}
`;
  }
}
```

### `ttl-cleanup.ts` — TTL CLEANUP MECHANISM

```typescript
import { readdir, unlink, stat } from 'fs/promises';
import { join } from 'path';
import type { EphemeralAgentRecord } from './types.js';

export interface CleanupResult {
  deletedFiles: string[];
  deletedAgentSlugs: string[];
  errors: string[];
  runAt: Date;
}

export class TTLCleanup {
  private static EPHEMERAL_DIR = join(process.cwd(), '.claude', 'agents', 'ephemeral');

  /**
   * Scans the ephemeral directory and removes agents whose TTL has expired.
   * Called by the SynthesisWorker on every run and registered as a daemon trigger.
   */
  static async runCleanup(registry: Map<string, EphemeralAgentRecord>): Promise<CleanupResult> {
    const result: CleanupResult = {
      deletedFiles: [],
      deletedAgentSlugs: [],
      errors: [],
      runAt: new Date(),
    };

    const now = new Date();

    for (const [slug, record] of registry.entries()) {
      if (record.promoted) continue; // never delete promoted agents
      if (record.expiresAt > now) continue; // not yet expired

      // Attempt to delete the file
      try {
        await unlink(record.filePath);
        result.deletedFiles.push(record.filePath);
      } catch (err) {
        result.errors.push(`Failed to delete ${record.filePath}: ${(err as Error).message}`);
      }

      // Remove from registry
      registry.delete(slug);
      result.deletedAgentSlugs.push(slug);
    }

    return result;
  }

  /**
   * Extends the TTL of an ephemeral agent (e.g., when it is actively being used).
   */
  static extendTTL(
    record: EphemeralAgentRecord,
    extensionMs: number = 24 * 60 * 60 * 1000
  ): EphemeralAgentRecord {
    return {
      ...record,
      expiresAt: new Date(Math.max(record.expiresAt.getTime(), Date.now()) + extensionMs),
    };
  }

  /**
   * Lists all files in the ephemeral directory that have no registry entry
   * (orphaned files from crashed processes) and returns them for cleanup.
   */
  static async findOrphans(registry: Map<string, EphemeralAgentRecord>): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(TTLCleanup.EPHEMERAL_DIR);
    } catch {
      return [];
    }

    const registeredFiles = new Set(Array.from(registry.values()).map(r => r.filePath));
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => join(TTLCleanup.EPHEMERAL_DIR, f))
      .filter(f => !registeredFiles.has(f));
  }
}
```

### `synthesis-worker.ts`

```typescript
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { SynthesisPromptTemplate, agentDefinitionSchema } from '../synthesis/synthesis-prompt-template.js';
import { EphemeralRegistry } from '../synthesis/ephemeral-registry.js';
import { TTLCleanup } from '../synthesis/ttl-cleanup.js';
import type { AgentDefinition, SynthesisRequest } from '../synthesis/types.js';
import { randomBytes } from 'crypto';

const EPHEMERAL_DIR = join(process.cwd(), '.claude', 'agents', 'ephemeral');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SynthesisWorker {
  private registry = EphemeralRegistry.getInstance();

  /**
   * Triggered when HNSW routing finds no agent above the similarity threshold.
   */
  async synthesize(request: SynthesisRequest): Promise<AgentDefinition> {
    // 1. Run TTL cleanup before synthesizing
    const cleanup = await TTLCleanup.runCleanup(this.registry.getAll());
    if (cleanup.deletedAgentSlugs.length > 0) {
      console.log(`[SynthesisWorker] Cleaned up ${cleanup.deletedAgentSlugs.length} expired agents`);
    }

    // 2. Build synthesis prompt
    const existingSlugs = Array.from(this.registry.getAll().keys());
    const prompt = SynthesisPromptTemplate.build(request, existingSlugs);

    // 3. Call Claude to generate agent definition
    const rawJSON = await this.callClaude(prompt);

    // 4. Parse and validate with Zod
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJSON);
    } catch (err) {
      throw new Error(`SynthesisWorker: LLM returned invalid JSON: ${(err as Error).message}`);
    }

    const validation = agentDefinitionSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(`SynthesisWorker: Generated agent failed schema validation: ${validation.error.message}`);
    }

    const definition: AgentDefinition = {
      ...validation.data,
      synthesizedAt: new Date(validation.data.synthesizedAt),
    };

    // 5. Write to ephemeral directory
    await mkdir(EPHEMERAL_DIR, { recursive: true });
    const filePath = join(EPHEMERAL_DIR, `${definition.slug}.md`);
    const markdown = SynthesisPromptTemplate.toAgentMarkdown(definition);
    await writeFile(filePath, markdown, 'utf8');

    // 6. Register with TTL
    this.registry.register({
      slug: definition.slug,
      filePath,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
      usageCount: 0,
      avgQualityScore: 0,
      promoted: false,
      synthesisRequestId: request.requestId,
    });

    console.log(`[SynthesisWorker] Synthesized ephemeral agent: ${definition.slug} (TTL: 24h)`);
    return definition;
  }

  private async callClaude(prompt: string): Promise<string> {
    // Production: use Claude Sonnet (higher capability for agent design)
    // Inject via dependency injection in tests
    throw new Error('callClaude must be injected in SynthesisWorker constructor for testing');
  }
}
```

### `ephemeral-registry.ts`

```typescript
import type { EphemeralAgentRecord } from './types.js';

export class EphemeralRegistry {
  private static instance: EphemeralRegistry;
  private records: Map<string, EphemeralAgentRecord> = new Map();

  static getInstance(): EphemeralRegistry {
    if (!EphemeralRegistry.instance) {
      EphemeralRegistry.instance = new EphemeralRegistry();
    }
    return EphemeralRegistry.instance;
  }

  register(record: EphemeralAgentRecord): void {
    if (this.records.has(record.slug)) {
      throw new Error(`Ephemeral agent already registered: ${record.slug}`);
    }
    this.records.set(record.slug, record);
  }

  static async isRegistered(slug: string): Promise<boolean> {
    return EphemeralRegistry.getInstance().records.has(slug);
  }

  getAll(): Map<string, EphemeralAgentRecord> {
    return new Map(this.records);
  }

  get(slug: string): EphemeralAgentRecord | undefined {
    return this.records.get(slug);
  }

  incrementUsage(slug: string, qualityScore?: number): void {
    const record = this.records.get(slug);
    if (!record) return;
    const newCount = record.usageCount + 1;
    const newAvg = qualityScore !== undefined
      ? (record.avgQualityScore * record.usageCount + qualityScore) / newCount
      : record.avgQualityScore;
    this.records.set(slug, { ...record, usageCount: newCount, avgQualityScore: newAvg });
  }

  markPromoted(slug: string): void {
    const record = this.records.get(slug);
    if (!record) throw new Error(`Ephemeral agent not found: ${slug}`);
    this.records.set(slug, { ...record, promoted: true });
  }

  listExpired(): EphemeralAgentRecord[] {
    const now = new Date();
    return Array.from(this.records.values()).filter(r => !r.promoted && r.expiresAt <= now);
  }
}
```

---

## 7. Testing Strategy

File: `v3/@claude-flow/hooks/src/__tests__/synthesis.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SynthesisPromptTemplate, agentDefinitionSchema } from '../synthesis/synthesis-prompt-template.js';
import { TTLCleanup } from '../synthesis/ttl-cleanup.js';
import { EphemeralRegistry } from '../synthesis/ephemeral-registry.js';

describe('agentDefinitionSchema', () => {
  const validDef = {
    slug: 'kubernetes-helm-reviewer',
    name: 'Kubernetes Helm Chart Reviewer',
    description: 'Specialist agent for reviewing Kubernetes Helm charts for security and best practices.',
    color: '#3970e4',
    emoji: '⛵',
    vibe: 'Scrutinizes Helm charts with deep Kubernetes expertise.',
    tools: ['Read', 'Grep', 'Glob'],
    systemPromptBody: 'You are an expert Kubernetes Helm chart reviewer. '.repeat(10),
    capability: { sandbox: 'docker' as const, planning_step: 'required' as const, confidence_threshold: 0.75 },
    tags: ['kubernetes', 'helm', 'devops'],
    synthesizedFrom: 'Review this Helm chart for security issues',
    synthesizedAt: new Date().toISOString(),
  };

  it('accepts a valid agent definition', () => {
    const result = agentDefinitionSchema.safeParse(validDef);
    expect(result.success).toBe(true);
  });

  it('rejects slugs with uppercase letters', () => {
    const result = agentDefinitionSchema.safeParse({ ...validDef, slug: 'MyAgent' });
    expect(result.success).toBe(false);
  });

  it('rejects system prompts under 200 chars', () => {
    const result = agentDefinitionSchema.safeParse({ ...validDef, systemPromptBody: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown tools', () => {
    const result = agentDefinitionSchema.safeParse({ ...validDef, tools: ['Read', 'UnknownTool'] });
    expect(result.success).toBe(false);
  });
});

describe('SynthesisPromptTemplate.build', () => {
  it('includes the task description in the prompt', () => {
    const prompt = SynthesisPromptTemplate.build({
      requestId: 'r1',
      taskDescription: 'Review Helm chart for CIS compliance',
      topMatchSlug: 'reviewer',
      topMatchScore: 0.45,
      existingAgentCount: 230,
      requestedAt: new Date(),
    }, ['reviewer', 'coder']);
    expect(prompt).toContain('Review Helm chart for CIS compliance');
    expect(prompt).toContain('0.450');
    expect(prompt).toContain('"sandbox": "docker"');
  });

  it('includes existing slug list to prevent conflicts', () => {
    const prompt = SynthesisPromptTemplate.build(
      { requestId: 'r1', taskDescription: 'task', topMatchSlug: 'x', topMatchScore: 0.5, existingAgentCount: 2, requestedAt: new Date() },
      ['existing-agent-1', 'existing-agent-2']
    );
    expect(prompt).toContain('existing-agent-1');
  });
});

describe('SynthesisPromptTemplate.toAgentMarkdown', () => {
  it('generates valid frontmatter markdown', () => {
    const def = {
      slug: 'test-agent', name: 'Test Agent', description: 'A test agent',
      color: 'blue', emoji: '🤖', vibe: 'Tests things.',
      tools: ['Read', 'Grep'],
      systemPromptBody: '# Test\nYou are a test agent.',
      capability: { sandbox: 'docker' as const, planning_step: 'required' as const, confidence_threshold: 0.75 },
      tags: ['test'], synthesizedFrom: 'test task', synthesizedAt: new Date(),
    };
    const md = SynthesisPromptTemplate.toAgentMarkdown(def);
    expect(md).toContain('name: Test Agent');
    expect(md).toContain('synthesized: true');
    expect(md).toContain('sandbox: docker');
    expect(md).toContain('tools: Read, Grep');
  });
});

describe('TTLCleanup', () => {
  it('identifies expired records for cleanup', async () => {
    const expiredRecord = {
      slug: 'old-agent', filePath: '/nonexistent/path.md',
      createdAt: new Date(Date.now() - 48 * 3600_000),
      expiresAt: new Date(Date.now() - 1000),  // expired 1 second ago
      usageCount: 0, avgQualityScore: 0, promoted: false, synthesisRequestId: 'r1',
    };
    const activeRecord = {
      ...expiredRecord, slug: 'new-agent',
      expiresAt: new Date(Date.now() + 24 * 3600_000), // not yet expired
    };

    const registry = new Map([['old-agent', expiredRecord], ['new-agent', activeRecord]]);
    // Mock unlink to avoid real FS calls
    vi.mock('fs/promises', () => ({ unlink: vi.fn(), readdir: vi.fn().mockResolvedValue([]) }));

    const result = await TTLCleanup.runCleanup(registry);
    expect(result.deletedAgentSlugs).toContain('old-agent');
    expect(result.deletedAgentSlugs).not.toContain('new-agent');
  });

  it('never deletes promoted agents even if past TTL', async () => {
    const promotedRecord = {
      slug: 'promoted-agent', filePath: '/nonexistent/path.md',
      createdAt: new Date(Date.now() - 48 * 3600_000),
      expiresAt: new Date(Date.now() - 1000),
      usageCount: 10, avgQualityScore: 0.9, promoted: true, synthesisRequestId: 'r1',
    };
    const registry = new Map([['promoted-agent', promotedRecord]]);
    const result = await TTLCleanup.runCleanup(registry);
    expect(result.deletedAgentSlugs).not.toContain('promoted-agent');
  });
});

describe('EphemeralRegistry', () => {
  it('increments usage count and updates quality average', () => {
    const registry = new EphemeralRegistry();
    const record = {
      slug: 'x', filePath: '/x.md',
      createdAt: new Date(), expiresAt: new Date(Date.now() + 86400_000),
      usageCount: 0, avgQualityScore: 0, promoted: false, synthesisRequestId: 'r1',
    };
    (registry as any).records.set('x', record);
    registry.incrementUsage('x', 0.8);
    registry.incrementUsage('x', 0.9);
    const updated = registry.get('x')!;
    expect(updated.usageCount).toBe(2);
    expect(updated.avgQualityScore).toBeCloseTo(0.85, 2);
  });
});
```

---

## 8. Definition of Done

- [ ] `agentDefinitionSchema` validates all required fields (slug format, tool subset, system prompt length).
- [ ] `SynthesisPromptTemplate.build` produces a prompt containing task description, top match score, and existing slug list.
- [ ] `SynthesisPromptTemplate.toAgentMarkdown` produces valid YAML-frontmatter markdown with `synthesized: true` marker.
- [ ] `TTLCleanup.runCleanup` deletes expired files and removes them from registry; never deletes promoted agents.
- [ ] `EphemeralRegistry` correctly tracks usage count and rolling quality average.
- [ ] `SynthesisWorker.synthesize` writes `.md` file to `.claude/agents/ephemeral/` with correct TTL.
- [ ] `agentTypeSchema` in `agent-tools.ts` accepts ephemeral agent slugs registered in `EphemeralRegistry`.
- [ ] `agent synth --task "<text>"` CLI subcommand triggers synthesis and prints the generated slug.
- [ ] `agent ephemeral list` CLI shows slug, TTL countdown, usage count, quality score.
- [ ] `agent promote --slug <slug>` copies `.claude/agents/ephemeral/<slug>.md` to `.claude/agents/<category>/<slug>.md` and adds slug to `ALLOWED_AGENT_TYPES`.
- [ ] AgentDB `storeWithTTL` and `deleteExpired` methods work correctly.
- [ ] All unit tests in `synthesis.test.ts` pass.
- [ ] Synthesized agents are blocked from running if Task 46 (Sandboxing) is not implemented (`capability.sandbox: 'docker'` must be provisioned before agent starts).
- [ ] TypeScript compiles with zero errors.
