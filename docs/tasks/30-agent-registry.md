# Task 30: Central Agent Registry API
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Medium
**Depends on:** Task 29 (Agent Versioning)
**Blocks:** Task 32 (MicroAgent Triggers), Task 39 (Specialization Scoring)

## 1. Current State

Agent definitions are discovered at runtime by scanning `.claude/agents/**/*.md` and comparing the `name` frontmatter against the flat `ALLOWED_AGENT_TYPES` string array in `v3/mcp/tools/agent-tools.ts` (lines 33–138, approximately 140 entries).

There is no machine-readable index:
- No `registry.json` or equivalent catalog file exists in `.claude/agents/`
- No capability or task-type tagging beyond what can be inferred from agent slugs
- No tool dependency tracking (which tools each agent declares)
- No namespace collision detection (two agents could define the same capability with conflicting semantics)
- The `ALLOWED_AGENT_TYPES` array in `agent-tools.ts` requires a manual code edit whenever a new agent is added or renamed

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/` — all agent directories (academic, design, engineering, marketing, etc.)
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `ALLOWED_AGENT_TYPES`, lines 33–138; `spawnAgentSchema`, lines 152–158
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/agent.ts` — `agent` CLI command
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB backend

## 2. Gap Analysis

**What's missing:**
1. No `registry.json` — discovery requires full directory scan on every spawn call
2. No capability tagging — cannot answer "which agents can do security audits?"
3. No task-type tagging — routing (Task 32 microagent triggers, Task 39 specialization scoring) has no structured metadata to work from
4. No tool dependency map — cannot detect when a tool deprecation (Task 31) will break agents
5. No conflict detection — two agents in different subdirectories could have the same slug
6. `ALLOWED_AGENT_TYPES` is hand-maintained — new agents require a code change + rebuild + redeploy
7. No deprecation tracking — replaced agents still appear in discovery results

**Concrete failure modes:**
- A new agent file added to `.claude/agents/specialized/` is invisible to `agent spawn` until `ALLOWED_AGENT_TYPES` is manually updated
- Task 32 (MicroAgent Triggers) needs to enumerate all agents with `triggers` metadata; no index exists
- Task 39 (Specialization Scoring) needs to look up `taskTypes` for each agent; must re-parse all 230 files on every lookup
- Task 31 (Tool Versioning) cannot warn which agents will break when a tool is deprecated without reading all agent files

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `.claude/agents/registry.json` | Machine-readable registry index (generated, not hand-edited) |
| `v3/@claude-flow/cli/src/agents/registry-builder.ts` | Scans `.claude/agents/**/*.md`, parses frontmatter, emits `registry.json` |
| `v3/@claude-flow/cli/src/agents/registry-query.ts` | In-memory query API over `registry.json`: `find()`, `validate()`, `conflicts()` |
| `v3/@claude-flow/cli/src/agents/registry-worker.ts` | Background worker that runs `registry-builder` on startup and after any `.md` file change |
| `v3/@claude-flow/cli/src/commands/registry.ts` | CLI subcommands: `registry find`, `registry validate`, `registry conflicts`, `registry rebuild` |
| `v3/@claude-flow/shared/src/types/agent-registry.ts` | Shared TypeScript interfaces `AgentRegistryEntry`, `AgentRegistry` |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/mcp/tools/agent-tools.ts` | Replace static `ALLOWED_AGENT_TYPES` array (lines 33–138) with dynamic load from `registry.json` at startup; keep the array as a fallback constant |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Import and register `registry` subcommand |
| `v3/@claude-flow/cli/src/commands/init.ts` | Run `registry-builder` during `init` to generate initial `registry.json` |
| `v3/@claude-flow/hooks/src/workers/index.ts` | Register `registry-worker` as a background worker triggered on session start |

## 5. Implementation Steps

**Step 1: Define shared types**

Create `v3/@claude-flow/shared/src/types/agent-registry.ts`:

```typescript
export interface AgentRegistryEntry {
  slug: string;               // e.g. "engineering-security-engineer"
  name: string;               // human display name from frontmatter
  version: string;            // semver from frontmatter (Task 29)
  category: string;           // directory path segment, e.g. "engineering"
  capabilities: string[];     // e.g. ["security-audit", "cve-analysis"]
  taskTypes: string[];        // e.g. ["audit", "review", "scan"]
  tools: string[];            // tool names declared in frontmatter
  triggers?: TriggerPattern[];// MicroAgent trigger patterns (Task 32)
  outputSchema?: string;      // JSON Schema file ref (Task 33 future)
  deprecated: boolean;
  deprecatedBy?: string;
  dependencies?: string[];    // agent slugs this agent delegates to
  filePath: string;           // relative path from repo root
  registeredAt: string;       // ISO 8601
  lastUpdated: string;        // ISO 8601 (file mtime)
}

export interface TriggerPattern {
  pattern: string;            // regex string
  mode: 'inject' | 'takeover';
}

export interface AgentRegistry {
  version: string;            // registry schema version, e.g. "1.0"
  generatedAt: string;        // ISO 8601
  totalAgents: number;
  agents: AgentRegistryEntry[];
}
```

**Step 2: Build registry-builder**

Create `v3/@claude-flow/cli/src/agents/registry-builder.ts`:

```typescript
import { readdir, readFile, stat, writeFile } from 'fs/promises';
import { join, relative, dirname, basename } from 'path';
import matter from 'gray-matter';
import type { AgentRegistry, AgentRegistryEntry } from '@claude-flow/shared/src/types/agent-registry.js';

const AGENTS_ROOT = '.claude/agents';
const REGISTRY_PATH = '.claude/agents/registry.json';

export async function buildRegistry(): Promise<AgentRegistry> {
  const entries: AgentRegistryEntry[] = [];
  await scanDir(AGENTS_ROOT, entries);

  const registry: AgentRegistry = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalAgents: entries.length,
    agents: entries.sort((a, b) => a.slug.localeCompare(b.slug)),
  };

  await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  return registry;
}

async function scanDir(dir: string, entries: AgentRegistryEntry[]): Promise<void> {
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory() && item.name !== 'schemas' && item.name !== 'ephemeral') {
      await scanDir(fullPath, entries);
      continue;
    }
    if (!item.name.endsWith('.md') || item.name === 'registry.json') continue;

    const content = await readFile(fullPath, 'utf-8');
    const fileStat = await stat(fullPath);
    const parsed = matter(content);
    const data = parsed.data;

    // Derive slug from filename stem (matches ALLOWED_AGENT_TYPES convention)
    const slug = basename(item.name, '.md');
    // Derive category from parent directory name
    const category = relative(AGENTS_ROOT, dirname(fullPath)) || 'root';

    const entry: AgentRegistryEntry = {
      slug,
      name: data.name ?? slug,
      version: data.version ?? '1.0.0',
      category,
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      taskTypes: Array.isArray(data.task_types) ? data.task_types : [],
      tools: Array.isArray(data.tools) ? data.tools : [],
      triggers: Array.isArray(data.capability?.triggers) ? data.capability.triggers : undefined,
      outputSchema: data.output_schema ?? undefined,
      deprecated: data.deprecated ?? false,
      deprecatedBy: data.deprecatedBy ?? undefined,
      dependencies: Array.isArray(data.dependencies) ? data.dependencies : undefined,
      filePath: relative('.', fullPath),
      registeredAt: new Date().toISOString(),
      lastUpdated: fileStat.mtime.toISOString(),
    };

    entries.push(entry);
  }
}
```

**Step 3: Build registry-query API**

Create `v3/@claude-flow/cli/src/agents/registry-query.ts`:

```typescript
import { readFile } from 'fs/promises';
import type { AgentRegistry, AgentRegistryEntry } from '@claude-flow/shared/src/types/agent-registry.js';

export class RegistryQuery {
  private registry: AgentRegistry | null = null;

  async load(registryPath = '.claude/agents/registry.json'): Promise<void> {
    const raw = await readFile(registryPath, 'utf-8');
    this.registry = JSON.parse(raw) as AgentRegistry;
  }

  private get agents(): AgentRegistryEntry[] {
    if (!this.registry) throw new Error('Registry not loaded. Call load() first.');
    return this.registry.agents;
  }

  findByCapability(capability: string): AgentRegistryEntry[] {
    return this.agents.filter(a =>
      !a.deprecated &&
      a.capabilities.some(c => c.toLowerCase().includes(capability.toLowerCase()))
    );
  }

  findByTaskType(taskType: string): AgentRegistryEntry[] {
    return this.agents.filter(a =>
      !a.deprecated &&
      a.taskTypes.some(t => t.toLowerCase().includes(taskType.toLowerCase()))
    );
  }

  findBySlug(slug: string): AgentRegistryEntry | undefined {
    return this.agents.find(a => a.slug === slug);
  }

  findByTool(toolName: string): AgentRegistryEntry[] {
    return this.agents.filter(a => a.tools.includes(toolName));
  }

  /** Returns agents that use triggers (MicroAgents — Task 32) */
  findMicroAgents(): AgentRegistryEntry[] {
    return this.agents.filter(a => a.triggers && a.triggers.length > 0);
  }

  validate(): ValidationResult[] {
    const results: ValidationResult[] = [];
    for (const agent of this.agents) {
      if (!agent.version.match(/^\d+\.\d+\.\d+$/)) {
        results.push({ slug: agent.slug, severity: 'error', message: `Invalid semver: ${agent.version}` });
      }
      if (agent.deprecated && !agent.deprecatedBy) {
        results.push({ slug: agent.slug, severity: 'warning', message: 'Deprecated agent has no deprecatedBy replacement' });
      }
      if (agent.capabilities.length === 0) {
        results.push({ slug: agent.slug, severity: 'warning', message: 'No capabilities declared' });
      }
    }
    return results;
  }

  conflicts(): ConflictResult[] {
    const results: ConflictResult[] = [];
    const slugSeen = new Map<string, string>();
    for (const agent of this.agents) {
      if (slugSeen.has(agent.slug)) {
        results.push({ type: 'duplicate-slug', agents: [agent.slug, slugSeen.get(agent.slug)!] });
      } else {
        slugSeen.set(agent.slug, agent.filePath);
      }
    }
    return results;
  }

  allSlugs(): string[] {
    return this.agents.map(a => a.slug);
  }
}

export interface ValidationResult {
  slug: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ConflictResult {
  type: 'duplicate-slug' | 'capability-conflict';
  agents: string[];
  details?: string;
}
```

**Step 4: Dynamic ALLOWED_AGENT_TYPES in agent-tools.ts**

Replace the static constant (lines 33–138) load pattern in `v3/mcp/tools/agent-tools.ts`:

```typescript
import { RegistryQuery } from '../../@claude-flow/cli/src/agents/registry-query.js';

// Keep static array as compile-time fallback for type safety
// (existing array stays for TypeScript type inference)

let _runtimeAgentSlugs: string[] | null = null;

export async function getAllowedAgentSlugs(): Promise<string[]> {
  if (_runtimeAgentSlugs) return _runtimeAgentSlugs;
  try {
    const query = new RegistryQuery();
    await query.load();
    _runtimeAgentSlugs = query.allSlugs();
    return _runtimeAgentSlugs;
  } catch {
    // Fallback to compile-time list if registry not yet built
    return [...ALLOWED_AGENT_TYPES];
  }
}
```

**Step 5: CLI commands**

Create `v3/@claude-flow/cli/src/commands/registry.ts`:

```typescript
import { Command } from 'commander';
import { buildRegistry } from '../agents/registry-builder.js';
import { RegistryQuery } from '../agents/registry-query.js';

export function registerRegistryCommand(program: Command): void {
  const cmd = program.command('registry').description('Agent registry operations');

  cmd.command('rebuild')
    .description('Scan .claude/agents/ and regenerate registry.json')
    .action(async () => {
      const registry = await buildRegistry();
      console.log(`Registry rebuilt: ${registry.totalAgents} agents indexed.`);
    });

  cmd.command('find')
    .option('--capability <cap>', 'Filter by capability')
    .option('--task-type <type>', 'Filter by task type')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const q = new RegistryQuery();
      await q.load();
      let results = opts.capability ? q.findByCapability(opts.capability)
                  : opts.taskType   ? q.findByTaskType(opts.taskType)
                  : q.findMicroAgents();
      if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
      console.table(results.map(r => ({ slug: r.slug, version: r.version, deprecated: r.deprecated })));
    });

  cmd.command('validate')
    .description('Validate all agent definitions')
    .action(async () => {
      const q = new RegistryQuery();
      await q.load();
      const issues = q.validate();
      if (issues.length === 0) { console.log('All agent definitions valid.'); return; }
      for (const issue of issues) {
        const icon = issue.severity === 'error' ? '✗' : '⚠';
        console.log(`${icon} [${issue.slug}] ${issue.message}`);
      }
      process.exitCode = issues.some(i => i.severity === 'error') ? 1 : 0;
    });

  cmd.command('conflicts')
    .description('Detect duplicate slugs or capability conflicts')
    .action(async () => {
      const q = new RegistryQuery();
      await q.load();
      const conflicts = q.conflicts();
      if (conflicts.length === 0) { console.log('No conflicts detected.'); return; }
      for (const c of conflicts) {
        console.log(`CONFLICT [${c.type}]: ${c.agents.join(' vs ')}`);
      }
      process.exitCode = 1;
    });
}
```

## 6. Key Code Templates

**Complete `registry.json` JSON Schema:**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://ruflo.ai/schemas/agent-registry.json",
  "title": "AgentRegistry",
  "type": "object",
  "required": ["version", "generatedAt", "totalAgents", "agents"],
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "string",
      "description": "Registry schema version",
      "examples": ["1.0"]
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "totalAgents": {
      "type": "integer",
      "minimum": 0
    },
    "agents": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/AgentRegistryEntry"
      }
    }
  },
  "$defs": {
    "AgentRegistryEntry": {
      "type": "object",
      "required": ["slug", "name", "version", "category", "capabilities", "taskTypes", "tools", "deprecated", "filePath", "registeredAt", "lastUpdated"],
      "additionalProperties": false,
      "properties": {
        "slug":         { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
        "name":         { "type": "string" },
        "version":      { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
        "category":     { "type": "string" },
        "capabilities": { "type": "array", "items": { "type": "string" } },
        "taskTypes":    { "type": "array", "items": { "type": "string" } },
        "tools":        { "type": "array", "items": { "type": "string" } },
        "triggers": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["pattern", "mode"],
            "properties": {
              "pattern": { "type": "string" },
              "mode":    { "type": "string", "enum": ["inject", "takeover"] }
            }
          }
        },
        "outputSchema": { "type": "string" },
        "deprecated":   { "type": "boolean" },
        "deprecatedBy": { "type": "string" },
        "dependencies": { "type": "array", "items": { "type": "string" } },
        "filePath":     { "type": "string" },
        "registeredAt": { "type": "string", "format": "date-time" },
        "lastUpdated":  { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

**Sample `registry.json` entry:**

```json
{
  "version": "1.0",
  "generatedAt": "2026-04-06T00:00:00.000Z",
  "totalAgents": 232,
  "agents": [
    {
      "slug": "engineering-security-engineer",
      "name": "Security Engineer",
      "version": "2.1.0",
      "category": "engineering",
      "capabilities": ["security-audit", "cve-analysis", "penetration-testing"],
      "taskTypes": ["audit", "scan", "review"],
      "tools": ["Bash", "Read", "Grep", "WebFetch"],
      "triggers": [
        { "pattern": "\\b(auth|jwt|session|oauth|saml)\\b", "mode": "inject" },
        { "pattern": "CVE-\\d{4}-\\d+", "mode": "inject" }
      ],
      "deprecated": false,
      "filePath": ".claude/agents/engineering/engineering-security-engineer.md",
      "registeredAt": "2026-04-06T00:00:00.000Z",
      "lastUpdated": "2026-04-06T00:00:00.000Z"
    }
  ]
}
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/agents/registry-builder.test.ts`):
- `buildRegistry()` finds all `.md` files recursively under `.claude/agents/`
- Skips `schemas/` and `ephemeral/` subdirectories
- Correctly derives `slug` from filename stem and `category` from parent dir
- Writes valid JSON to `registry.json`
- Is idempotent (second run produces identical output given unchanged files)

**Unit tests** (`v3/@claude-flow/cli/tests/agents/registry-query.test.ts`):
- `findByCapability("security-audit")` returns only agents with that capability
- `findByCapability()` excludes `deprecated: true` agents
- `validate()` returns an error for agents with non-semver `version`
- `conflicts()` detects two agents with the same slug
- `findMicroAgents()` returns only agents with non-empty `triggers`

**Integration tests** (`v3/@claude-flow/cli/tests/commands/registry.test.ts`):
- `registry rebuild` produces `registry.json` with `totalAgents` matching actual file count
- `registry validate` exits 0 when all agents are valid
- `registry conflicts` exits 1 when a duplicate slug exists in test fixtures
- `registry find --capability security-audit` prints correct agent slug

**agent-tools.ts integration test:**
- `getAllowedAgentSlugs()` returns all slugs from `registry.json` at runtime
- Falls back to static `ALLOWED_AGENT_TYPES` when `registry.json` is missing

## 8. Definition of Done

- [ ] `registry.json` is generated at `.claude/agents/registry.json` after running `npx claude-flow@v3alpha registry rebuild`
- [ ] `registry.json` validates against the JSON Schema defined in this task
- [ ] `npx claude-flow@v3alpha registry find --capability security-audit` returns relevant agents
- [ ] `npx claude-flow@v3alpha registry validate` exits 0 for the current agent set
- [ ] `npx claude-flow@v3alpha registry conflicts` exits 0 (no duplicates)
- [ ] `agent spawn` resolves valid agent types from `registry.json` at runtime, not only the static array
- [ ] `init` command triggers `registry rebuild` automatically
- [ ] `registry-worker` background worker re-indexes on file changes during daemon mode
- [ ] All unit and integration tests pass
- [ ] TypeScript compiles without errors in `v3/@claude-flow/cli/`
