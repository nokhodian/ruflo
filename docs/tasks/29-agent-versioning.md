# Task 29: Agent Definition Versioning + Rollback
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Medium
**Depends on:** (none — can start independently)
**Blocks:** Task 30 (Agent Registry), Task 33 (Eval Datasets)

## 1. Current State

Agent definitions live as Markdown files with YAML frontmatter under `.claude/agents/**/*.md`. There are 230+ such files across directories including `.claude/agents/engineering/`, `.claude/agents/security/`, `.claude/agents/marketing/`, etc.

**Current frontmatter shape (representative sample from `.claude/agents/engineering/`):**
```yaml
---
name: Security Engineer
description: "Performs security audits, CVE analysis..."
tools:
  - Bash
  - Read
  - Grep
---
```

No `version`, `changelog`, `deprecated`, or `deprecatedBy` fields exist on any agent file today. The `ALLOWED_AGENT_TYPES` constant in `v3/mcp/tools/agent-tools.ts` (lines 33–138) is a flat string array with no version information.

There is no version history stored in AgentDB (`v3/@claude-flow/memory/src/agentdb-backend.ts`). Rolling back a broken agent definition today requires `git log` archaeology and manual file restoration.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/**/*.md` — all agent definitions (230+)
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `ALLOWED_AGENT_TYPES` array, lines 33–138
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB storage backend
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/agent.ts` — `agent` CLI command

## 2. Gap Analysis

**What's missing:**
1. No `version` field in any agent frontmatter — impossible to detect breaking changes between edits
2. No `changelog` field — intent of changes is lost after git squash/rebase
3. No `deprecated` / `deprecatedBy` fields — agents are quietly orphaned without migration paths
4. No version history table in AgentDB — rollback requires filesystem or git operations
5. CLI has no `agent version` subcommand — operators cannot inspect history or roll back
6. `ALLOWED_AGENT_TYPES` in `agent-tools.ts` cannot distinguish `engineering-security-engineer@2.0.0` from `@2.1.0`

**Concrete failure modes:**
- A prompt change to `engineering-backend-architect` silently degrades code quality; no way to identify when the regression started
- An agent that becomes `deprecated: true` still gets routed to by Task 30's registry and Task 32's DLQ replays
- Task 33 (eval datasets) cannot correlate production failures with specific agent versions
- Task 34 (regression benchmarks) cannot pin which agent version passed the baseline

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/cli/src/agents/version-store.ts` | AgentDB read/write for version history; `saveVersion()`, `listVersions()`, `rollback()` |
| `v3/@claude-flow/cli/src/agents/version-diff.ts` | Unified diff generator between two version snapshots |
| `v3/@claude-flow/cli/src/commands/agent-version.ts` | CLI subcommand handler for `agent version list/rollback/diff` |
| `v3/@claude-flow/shared/src/types/agent-version.ts` | Shared TypeScript interfaces `AgentVersion`, `AgentVersionRecord` |
| `docs/tasks/agent-versioning-migration.md` | Migration runbook: how to add version frontmatter to all 230+ existing agents |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `.claude/agents/**/*.md` | Add `version`, `changelog`, `deprecated`, `deprecatedBy` frontmatter fields to every agent file (230+ files; use a migration script) |
| `v3/mcp/tools/agent-tools.ts` | Extend `spawnAgentSchema` (line 152) with optional `version` field; update `ALLOWED_AGENT_TYPES` docblock to note versioning |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Register `agent version` subcommand; import `AgentVersionCommand` |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `agent_versions` table migration; expose `storeAgentVersion()` and `fetchAgentVersions()` methods |

## 5. Implementation Steps

**Step 1: Define the TypeScript interfaces**

Create `v3/@claude-flow/shared/src/types/agent-version.ts`:

```typescript
export interface AgentVersion {
  slug: string;          // e.g. "engineering-security-engineer"
  version: string;       // semver e.g. "2.1.0"
  changelog: string;     // human-readable change summary
  deprecated: boolean;
  deprecatedBy?: string; // slug of replacement agent if deprecated
  content: string;       // full raw Markdown file content snapshot
  contentHash: string;   // sha256 of content for integrity checks
  capturedAt: Date;
  capturedBy: string;    // 'cli' | 'registry-worker' | 'manual'
}

export interface AgentVersionRecord extends AgentVersion {
  id: number;            // AgentDB row id
  isCurrent: boolean;
}
```

**Step 2: Add frontmatter fields to existing agent files**

Write a one-shot migration script `scripts/migrate-agent-versions.ts`:

```typescript
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';

const AGENTS_ROOT = '.claude/agents';

async function migrate(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) { await migrate(fullPath); continue; }
    if (!entry.name.endsWith('.md')) continue;
    const raw = await readFile(fullPath, 'utf-8');
    const parsed = matter(raw);
    if (parsed.data.version) continue; // already migrated
    parsed.data.version = '1.0.0';
    parsed.data.changelog = 'Initial version — migrated from unversioned definition';
    parsed.data.deprecated = false;
    await writeFile(fullPath, matter.stringify(parsed.content, parsed.data));
    console.log(`Migrated: ${fullPath}`);
  }
}

migrate(AGENTS_ROOT).catch(console.error);
```

Run: `npx tsx scripts/migrate-agent-versions.ts`

**Step 3: Add frontmatter schema (the full required addition for every agent)**

```yaml
---
name: Security Engineer
version: "2.1.0"
changelog: "Added CVE database lookup tool; improved OWASP Top-10 coverage"
deprecated: false
# deprecatedBy: "engineering-security-architect"  # uncomment when deprecating
description: "..."
tools:
  - Bash
  - Read
  - Grep
---
```

**Step 4: Add AgentDB version storage**

In `v3/@claude-flow/memory/src/agentdb-backend.ts`, add to the schema migration:

```typescript
await db.exec(`
  CREATE TABLE IF NOT EXISTS agent_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT    NOT NULL,
    version     TEXT    NOT NULL,
    changelog   TEXT    NOT NULL DEFAULT '',
    deprecated  INTEGER NOT NULL DEFAULT 0,
    deprecated_by TEXT,
    content     TEXT    NOT NULL,
    content_hash TEXT   NOT NULL,
    is_current  INTEGER NOT NULL DEFAULT 1,
    captured_at TEXT    NOT NULL,
    captured_by TEXT    NOT NULL DEFAULT 'cli',
    UNIQUE(slug, version)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_versions_slug ON agent_versions(slug);
  CREATE INDEX IF NOT EXISTS idx_agent_versions_current ON agent_versions(slug, is_current);
`);
```

**Step 5: Implement version store**

Create `v3/@claude-flow/cli/src/agents/version-store.ts`:

```typescript
import { createHash } from 'crypto';
import { AgentVersionRecord } from '@claude-flow/shared/src/types/agent-version.js';

export class AgentVersionStore {
  constructor(private db: AgentDBBackend) {}

  async saveVersion(slug: string, content: string, capturedBy = 'cli'): Promise<AgentVersionRecord> {
    const parsed = parseFrontmatter(content);
    const version = parsed.data.version ?? '1.0.0';
    const changelog = parsed.data.changelog ?? '';
    const deprecated = parsed.data.deprecated ?? false;
    const deprecatedBy = parsed.data.deprecatedBy ?? null;
    const contentHash = createHash('sha256').update(content).digest('hex');

    // Mark all existing as non-current
    await this.db.run(
      'UPDATE agent_versions SET is_current = 0 WHERE slug = ?',
      [slug]
    );

    const result = await this.db.run(
      `INSERT OR REPLACE INTO agent_versions
       (slug, version, changelog, deprecated, deprecated_by, content, content_hash, is_current, captured_at, captured_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [slug, version, changelog, deprecated ? 1 : 0, deprecatedBy, content, contentHash,
       new Date().toISOString(), capturedBy]
    );

    return { id: result.lastID, slug, version, changelog, deprecated, deprecatedBy,
             content, contentHash, isCurrent: true, capturedAt: new Date(), capturedBy };
  }

  async listVersions(slug: string): Promise<AgentVersionRecord[]> {
    return this.db.all(
      'SELECT * FROM agent_versions WHERE slug = ? ORDER BY captured_at DESC',
      [slug]
    );
  }

  async rollback(slug: string, toVersion: string): Promise<AgentVersionRecord> {
    const record = await this.db.get(
      'SELECT * FROM agent_versions WHERE slug = ? AND version = ?',
      [slug, toVersion]
    );
    if (!record) throw new Error(`Version ${toVersion} not found for agent ${slug}`);

    // Restore file content
    const agentPath = await resolveAgentPath(slug);
    await writeFile(agentPath, record.content);

    // Mark as current in DB
    await this.db.run('UPDATE agent_versions SET is_current = 0 WHERE slug = ?', [slug]);
    await this.db.run('UPDATE agent_versions SET is_current = 1 WHERE id = ?', [record.id]);

    return record;
  }
}
```

**Step 6: Implement CLI subcommand**

Create `v3/@claude-flow/cli/src/commands/agent-version.ts`:

```typescript
import { Command } from 'commander';
import { AgentVersionStore } from '../agents/version-store.js';
import { AgentVersionDiff } from '../agents/version-diff.js';

export function registerAgentVersionCommand(agentCmd: Command): void {
  const versionCmd = agentCmd.command('version').description('Manage agent definition versions');

  versionCmd
    .command('list')
    .argument('<slug>', 'Agent slug')
    .option('--json', 'Output as JSON')
    .action(async (slug, opts) => {
      const store = await getVersionStore();
      const versions = await store.listVersions(slug);
      if (opts.json) { console.log(JSON.stringify(versions, null, 2)); return; }
      console.table(versions.map(v => ({
        version: v.version,
        current: v.isCurrent ? '✓' : '',
        deprecated: v.deprecated ? '⚠' : '',
        capturedAt: v.capturedAt,
        changelog: v.changelog.slice(0, 60)
      })));
    });

  versionCmd
    .command('rollback')
    .argument('<slug>', 'Agent slug')
    .requiredOption('--to <version>', 'Target version to restore')
    .action(async (slug, opts) => {
      const store = await getVersionStore();
      const record = await store.rollback(slug, opts.to);
      console.log(`Rolled back ${slug} to v${record.version}`);
    });

  versionCmd
    .command('diff')
    .argument('<slug>', 'Agent slug')
    .requiredOption('--from <version>')
    .requiredOption('--to <version>')
    .action(async (slug, opts) => {
      const store = await getVersionStore();
      const differ = new AgentVersionDiff(store);
      const diff = await differ.diff(slug, opts.from, opts.to);
      console.log(diff);
    });
}
```

**Step 7: Wire into agent command**

In `v3/@claude-flow/cli/src/commands/agent.ts`, add:

```typescript
import { registerAgentVersionCommand } from './agent-version.js';
// Inside the command registration block:
registerAgentVersionCommand(agentCommand);
```

## 6. Key Code Templates

**Full frontmatter schema addition (all fields):**

```yaml
---
# === Identity ===
name: Security Engineer
slug: engineering-security-engineer    # must match filename stem and ALLOWED_AGENT_TYPES

# === Versioning (NEW — Task 29) ===
version: "2.1.0"                       # semver; bump MAJOR for prompt rewrites, MINOR for tool adds, PATCH for fixes
changelog: "Added CVE-2024 lookup; improved OWASP Top-10 prompt coverage"
deprecated: false
# deprecatedBy: "engineering-security-architect"  # set when deprecated=true

# === Existing fields (unchanged) ===
description: "Performs security audits..."
tools:
  - Bash
  - Read
  - Grep
  - WebFetch
---
```

**AgentDB SQL schema (full):**

```sql
CREATE TABLE IF NOT EXISTS agent_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL,
  version       TEXT    NOT NULL,
  changelog     TEXT    NOT NULL DEFAULT '',
  deprecated    INTEGER NOT NULL DEFAULT 0,   -- 0=false, 1=true
  deprecated_by TEXT,                          -- replacement slug
  content       TEXT    NOT NULL,              -- full raw .md file snapshot
  content_hash  TEXT    NOT NULL,              -- sha256 hex
  is_current    INTEGER NOT NULL DEFAULT 1,   -- 0=historical, 1=active
  captured_at   TEXT    NOT NULL,              -- ISO 8601
  captured_by   TEXT    NOT NULL DEFAULT 'cli',
  UNIQUE(slug, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_slug    ON agent_versions(slug);
CREATE INDEX IF NOT EXISTS idx_agent_versions_current ON agent_versions(slug, is_current);
CREATE INDEX IF NOT EXISTS idx_agent_versions_dep     ON agent_versions(deprecated);
```

**CLI commands:**

```bash
# List all versions of an agent
npx claude-flow@v3alpha agent version list --slug engineering-security-engineer

# Roll back to a prior version (restores file + updates DB)
npx claude-flow@v3alpha agent version rollback --slug engineering-security-engineer --to 2.0.0

# Show unified diff between two versions
npx claude-flow@v3alpha agent version diff --slug engineering-security-engineer --from 2.0.0 --to 2.1.0

# Run migration script for all existing agents
npx tsx scripts/migrate-agent-versions.ts
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/agents/version-store.test.ts`):
- `saveVersion()` correctly parses frontmatter and stores in DB
- `saveVersion()` marks previous version as `is_current = 0`
- `listVersions()` returns records sorted by `captured_at DESC`
- `rollback()` restores file content and flips `is_current`
- `rollback()` throws on unknown version slug
- `saveVersion()` with `deprecated: true` correctly sets `deprecated = 1`

**Integration tests** (`v3/@claude-flow/cli/tests/commands/agent-version.test.ts`):
- `agent version list <slug>` outputs table with correct version count
- `agent version rollback --slug X --to 1.0.0` writes correct file content
- `agent version diff --slug X --from 1.0.0 --to 2.0.0` outputs non-empty unified diff
- Attempting rollback to non-existent version exits with code 1 and error message

**Migration test:**
- Run `migrate-agent-versions.ts` against a temp copy of `.claude/agents/`
- Assert every `.md` file now has `version: "1.0.0"` in frontmatter
- Assert no file was corrupted (parse-then-re-serialize round-trip)

## 8. Definition of Done

- [ ] All 230+ agent `.md` files have `version`, `changelog`, `deprecated` frontmatter fields
- [ ] `agent_versions` table exists in AgentDB after `npx claude-flow@v3alpha init`
- [ ] `npx claude-flow@v3alpha agent version list --slug <slug>` returns at least 1 record for any known agent
- [ ] `npx claude-flow@v3alpha agent version rollback --slug <slug> --to 1.0.0` restores file and prints confirmation
- [ ] `npx claude-flow@v3alpha agent version diff` outputs valid unified diff
- [ ] Unit tests pass: `npm test -- --grep "AgentVersionStore"`
- [ ] `migrate-agent-versions.ts` is idempotent (re-running it does not duplicate records)
- [ ] `deprecated: true` agents surface a console warning when targeted by `agent spawn`
- [ ] TypeScript compiles without errors: `npm run build` in `v3/@claude-flow/cli/`
