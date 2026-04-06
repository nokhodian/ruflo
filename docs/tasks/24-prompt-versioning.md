# Task 24: Prompt Version Management
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** Low  
**Depends on:** none (standalone, but enhanced by Task 25 BootstrapFewShot which writes new versions)  
**Blocks:** Task 25 (BootstrapFewShot — writes optimized prompts as new versions)

## 1. Current State

Agent system prompts are stored as string literals in `.claude/agents/**/*.md` files.

| Component | Location | Current Behavior |
|---|---|---|
| Agent definitions | `.claude/agents/**/*.md` | Frontmatter + system prompt in a single markdown file |
| Version tracking | Git history only | No semantic versioning, no version metadata in the file |
| A/B testing | No implementation | No infrastructure for routing traffic to candidate prompts |
| Active prompt resolution | `v3/mcp/tools/agent-tools.ts` | Reads the agent file at spawn time; uses whatever is on disk |
| Prompt history | No implementation | AgentDB has no prompt version table |
| Quality scores | No implementation | No link between prompt version and task quality metrics |

**Concrete failure mode:** A prompt for `engineering-security-engineer` is updated to fix a false-positive issue. Three days later, the "fix" introduced a new false-negative regression. To revert, an engineer must use `git log` to find the previous version, `git show` to extract it, then manually copy it back — with no guarantee the manual copy is byte-for-byte correct. There is no A/B mechanism to test the fix on 10% of tasks first.

## 2. Gap Analysis

- No `PromptVersion` table in AgentDB — no persistent version history separate from git.
- No semver tagging of agent prompts — can't reference "version 1.2.0" independently of git SHA.
- No A/B experiment configuration — no way to route X% of spawns to a candidate prompt.
- No link between traces (Task 19) and which prompt version was active — can't attribute quality score changes to prompt changes.
- No CLI commands for version listing, diff, rollback, or promotion.
- No `PromptExperiment` runtime traffic splitter.

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/memory/src/prompt-version-store.ts` | CRUD for `PromptVersion` records in AgentDB SQLite |
| `v3/@claude-flow/cli/src/agents/prompt-version-manager.ts` | Business logic: publish new version, promote, rollback, start/stop experiment |
| `v3/@claude-flow/cli/src/agents/prompt-experiment.ts` | Traffic splitter: routes a spawn to control or candidate version based on `trafficPct` |
| `v3/@claude-flow/cli/src/commands/prompt.ts` | New CLI command group: `prompt version list|diff|rollback|promote|experiment` |
| `tests/agents/prompt-versioning.test.ts` | Unit tests for store CRUD, traffic splitter distribution |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/mcp/tools/agent-tools.ts` | In spawn handler, call `PromptVersionManager.resolvePrompt(agentSlug)` to get active prompt version instead of reading file directly; record active version in agent metadata | Every spawn uses the versioned store; version is traceable per task |
| `v3/@claude-flow/memory/src/agent-db.ts` | Add `createPromptVersionsTable()` migration and `PromptVersionStore` initialization | Persistent storage for version history |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Add reference to `prompt` subcommand in agent command help | Discovery |

## 5. Implementation Steps

1. **Define the schema** — Create `prompt-version-store.ts` with the SQLite DDL and the `PromptVersion` and `PromptExperiment` TypeScript interfaces.

2. **Run the migration** — In `agent-db.ts`, add `createPromptVersionsTable()` to the `initialize()` method. Use `IF NOT EXISTS` so it is idempotent.

3. **Implement `PromptVersionStore`** — CRUD methods:
   - `save(version: PromptVersion): Promise<void>` — upsert on `(agentSlug, version)` unique key
   - `getActive(agentSlug: string): Promise<PromptVersion | null>` — returns the version where `activeTo IS NULL`
   - `listVersions(agentSlug: string): Promise<PromptVersion[]>` — ordered by `activeFrom DESC`
   - `setActive(agentSlug: string, version: string): Promise<void>` — closes `activeTo` on old active, opens new
   - `diff(agentSlug, vA, vB): Promise<DiffResult>` — returns line-level diff between two versions

4. **Implement `PromptVersionManager`** — Business logic layer:
   - `publishFromFile(agentSlug, filePath, newVersion, changelog)`: reads current file, saves as new version, does NOT auto-promote (human must call `promote` or A/B test must promote automatically).
   - `promote(agentSlug, version)`: calls `store.setActive`.
   - `rollback(agentSlug, stepsBack = 1)`: finds the previous active version and promotes it.
   - `startExperiment(experiment: PromptExperiment)`: saves experiment config to AgentDB.
   - `stopExperiment(agentSlug)`: clears experiment; leaves winner as active based on quality scores.

5. **Implement traffic splitter** — In `prompt-experiment.ts`, `resolvePromptForSpawn(agentSlug)`:
   - Check if an active experiment exists for the slug.
   - If yes, use `Math.random() < experiment.trafficPct` to select candidate vs. control.
   - Return `{ prompt, version, isCandidate }`.

6. **Wire into spawn handler** — In `agent-tools.ts`, replace the direct file read with `PromptExperiment.resolvePromptForSpawn(agentSlug)`. Store the resolved `version` and `isCandidate` in agent metadata.

7. **Build CLI commands** — In `commands/prompt.ts`, implement `list`, `diff`, `rollback`, `promote`, and `experiment start/stop/status` subcommands.

8. **Seed initial versions** — In `daemon start` (or on first `agent spawn`), auto-publish the current file content as version `1.0.0` for any agent that has no version in the store yet.

## 6. Key Code Templates

```typescript
// v3/@claude-flow/memory/src/prompt-version-store.ts

export interface PromptVersion {
  agentSlug:    string;
  version:      string;      // semver: "1.3.0"
  prompt:       string;      // full system prompt text
  changelog:    string;      // human-readable change summary
  activeFrom:   Date;
  activeTo?:    Date;        // null = currently active
  qualityScore?: number;     // 0.0–1.0; set by BootstrapFewShot (Task 25)
  traceCount:   number;      // number of task runs using this version
  publishedBy:  string;      // 'human' | 'bootstrap-fewshot' | 'migration'
  createdAt:    Date;
}

export interface PromptExperiment {
  agentSlug:   string;
  control:     string;       // version semver string
  candidate:   string;       // version semver string
  trafficPct:  number;       // 0.0–1.0; fraction of spawns using candidate
  startedAt:   Date;
  endsAt?:     Date;
  winnerId?:   string;       // populated when experiment concludes
}

export interface DiffResult {
  agentSlug: string;
  versionA:  string;
  versionB:  string;
  additions: number;
  deletions: number;
  hunks:     Array<{ lineA: number; lineB: number; context: string }>;
}

const CREATE_PROMPT_VERSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS prompt_versions (
    agent_slug    TEXT NOT NULL,
    version       TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    changelog     TEXT NOT NULL DEFAULT '',
    active_from   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active_to     TIMESTAMP,
    quality_score REAL,
    trace_count   INTEGER NOT NULL DEFAULT 0,
    published_by  TEXT NOT NULL DEFAULT 'human',
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_slug, version)
  );

  CREATE INDEX IF NOT EXISTS idx_pv_active ON prompt_versions(agent_slug, active_to);

  CREATE TABLE IF NOT EXISTS prompt_experiments (
    agent_slug   TEXT PRIMARY KEY,
    control      TEXT NOT NULL,
    candidate    TEXT NOT NULL,
    traffic_pct  REAL NOT NULL DEFAULT 0.1,
    started_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at      TIMESTAMP,
    winner_id    TEXT
  );
`;

export class PromptVersionStore {
  constructor(private db: Database) {
    this.db.exec(CREATE_PROMPT_VERSIONS_TABLE);
  }

  async save(version: PromptVersion): Promise<void> {
    this.db.prepare(`
      INSERT INTO prompt_versions (agent_slug, version, prompt, changelog, active_from, published_by)
      VALUES (@agentSlug, @version, @prompt, @changelog, @activeFrom, @publishedBy)
      ON CONFLICT(agent_slug, version) DO UPDATE SET
        prompt = excluded.prompt,
        changelog = excluded.changelog
    `).run({
      agentSlug: version.agentSlug,
      version: version.version,
      prompt: version.prompt,
      changelog: version.changelog,
      activeFrom: version.activeFrom.toISOString(),
      publishedBy: version.publishedBy,
    });
  }

  getActive(agentSlug: string): PromptVersion | null {
    const row = this.db.prepare(`
      SELECT * FROM prompt_versions
      WHERE agent_slug = ? AND active_to IS NULL
      ORDER BY active_from DESC LIMIT 1
    `).get(agentSlug) as Record<string, unknown> | undefined;
    return row ? rowToVersion(row) : null;
  }

  listVersions(agentSlug: string): PromptVersion[] {
    const rows = this.db.prepare(`
      SELECT * FROM prompt_versions WHERE agent_slug = ?
      ORDER BY created_at DESC
    `).all(agentSlug) as Record<string, unknown>[];
    return rows.map(rowToVersion);
  }

  setActive(agentSlug: string, version: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE prompt_versions SET active_to = ? WHERE agent_slug = ? AND active_to IS NULL
    `).run(now, agentSlug);
    this.db.prepare(`
      UPDATE prompt_versions SET active_from = ?, active_to = NULL WHERE agent_slug = ? AND version = ?
    `).run(now, agentSlug, version);
  }

  updateQualityScore(agentSlug: string, version: string, score: number): void {
    this.db.prepare(`
      UPDATE prompt_versions SET quality_score = ?, trace_count = trace_count + 1
      WHERE agent_slug = ? AND version = ?
    `).run(score, agentSlug, version);
  }

  saveExperiment(exp: PromptExperiment): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO prompt_experiments
        (agent_slug, control, candidate, traffic_pct, started_at, ends_at)
      VALUES (@agentSlug, @control, @candidate, @trafficPct, @startedAt, @endsAt)
    `).run({
      agentSlug: exp.agentSlug, control: exp.control, candidate: exp.candidate,
      trafficPct: exp.trafficPct, startedAt: exp.startedAt.toISOString(),
      endsAt: exp.endsAt?.toISOString() ?? null,
    });
  }

  getExperiment(agentSlug: string): PromptExperiment | null {
    const row = this.db.prepare(
      `SELECT * FROM prompt_experiments WHERE agent_slug = ? AND winner_id IS NULL`
    ).get(agentSlug) as Record<string, unknown> | undefined;
    return row ? rowToExperiment(row) : null;
  }

  concludeExperiment(agentSlug: string, winnerId: string): void {
    this.db.prepare(`
      UPDATE prompt_experiments SET winner_id = ? WHERE agent_slug = ?
    `).run(winnerId, agentSlug);
  }
}
```

```typescript
// v3/@claude-flow/cli/src/agents/prompt-experiment.ts

import { PromptVersionStore, PromptVersion } from '../../../@claude-flow/memory/src/prompt-version-store.js';

export interface ResolvedPrompt {
  prompt:      string;
  version:     string;
  isCandidate: boolean;
  agentSlug:   string;
}

export class PromptExperimentRouter {
  constructor(private store: PromptVersionStore) {}

  resolvePromptForSpawn(agentSlug: string): ResolvedPrompt {
    const experiment = this.store.getExperiment(agentSlug);

    if (experiment) {
      const useCandidate = Math.random() < experiment.trafficPct;
      const version = useCandidate ? experiment.candidate : experiment.control;
      const pv = this.store.listVersions(agentSlug).find(v => v.version === version);
      if (pv) {
        return { prompt: pv.prompt, version: pv.version, isCandidate: useCandidate, agentSlug };
      }
    }

    // No experiment or version not found — fall back to active version
    const active = this.store.getActive(agentSlug);
    if (active) {
      return { prompt: active.prompt, version: active.version, isCandidate: false, agentSlug };
    }

    // No version in store — return empty sentinel; spawn handler falls back to file
    return { prompt: '', version: 'unversioned', isCandidate: false, agentSlug };
  }
}
```

### CLI Command Examples

```bash
# List all versions for an agent
npx claude-flow@v3alpha prompt version list --agent engineering-security-engineer

# Output:
# VERSION   ACTIVE  QUALITY  TRACES  PUBLISHED_BY         CHANGELOG
# 1.3.0     ✓       0.87     142     bootstrap-fewshot    Added 3 few-shot examples
# 1.2.1     -       0.81     89      human                Fixed false-positive on JWT
# 1.2.0     -       0.79     67      human                Initial structured output
# 1.0.0     -       0.74     201     migration            Auto-seeded from file

# Show diff between two versions
npx claude-flow@v3alpha prompt version diff --agent engineering-security-engineer --from 1.2.0 --to 1.3.0

# Rollback to previous version
npx claude-flow@v3alpha prompt version rollback --agent engineering-security-engineer

# Promote a specific version
npx claude-flow@v3alpha prompt version promote --agent engineering-security-engineer --version 1.2.1

# Start an A/B experiment
npx claude-flow@v3alpha prompt experiment start \
  --agent engineering-security-engineer \
  --control 1.2.1 \
  --candidate 1.3.0 \
  --traffic-pct 0.1

# Check experiment status
npx claude-flow@v3alpha prompt experiment status --agent engineering-security-engineer

# Stop experiment and promote winner
npx claude-flow@v3alpha prompt experiment stop --agent engineering-security-engineer --promote-winner
```

## 7. Testing Strategy

```typescript
// tests/agents/prompt-versioning.test.ts
import Database from 'better-sqlite3';
import { PromptVersionStore } from '../../v3/@claude-flow/memory/src/prompt-version-store.js';
import { PromptExperimentRouter } from '../../v3/@claude-flow/cli/src/agents/prompt-experiment.js';

describe('PromptVersionStore', () => {
  let db: Database.Database;
  let store: PromptVersionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new PromptVersionStore(db);
  });

  it('saves and retrieves the active version', () => {
    store.save({ agentSlug: 'coder', version: '1.0.0', prompt: 'Be a coder.',
      changelog: 'Initial', activeFrom: new Date(), traceCount: 0, publishedBy: 'human', createdAt: new Date() });
    store.setActive('coder', '1.0.0');
    const active = store.getActive('coder');
    expect(active?.version).toBe('1.0.0');
    expect(active?.prompt).toBe('Be a coder.');
  });

  it('setActive closes old version and opens new one', () => {
    store.save({ agentSlug: 'coder', version: '1.0.0', prompt: 'v1', changelog: '', activeFrom: new Date(), traceCount: 0, publishedBy: 'human', createdAt: new Date() });
    store.save({ agentSlug: 'coder', version: '1.1.0', prompt: 'v2', changelog: '', activeFrom: new Date(), traceCount: 0, publishedBy: 'human', createdAt: new Date() });
    store.setActive('coder', '1.0.0');
    store.setActive('coder', '1.1.0');
    const active = store.getActive('coder');
    expect(active?.version).toBe('1.1.0');
    const all = store.listVersions('coder');
    expect(all.find(v => v.version === '1.0.0')?.activeTo).not.toBeNull();
  });

  it('returns null for missing agent', () => {
    expect(store.getActive('nonexistent')).toBeNull();
  });
});

describe('PromptExperimentRouter traffic splitting', () => {
  it('routes approximately trafficPct of calls to candidate', () => {
    const db = new Database(':memory:');
    const store = new PromptVersionStore(db);
    // Setup versions and experiment
    store.save({ agentSlug: 'coder', version: '1.0.0', prompt: 'control', changelog: '', activeFrom: new Date(), traceCount: 0, publishedBy: 'human', createdAt: new Date() });
    store.save({ agentSlug: 'coder', version: '1.1.0', prompt: 'candidate', changelog: '', activeFrom: new Date(), traceCount: 0, publishedBy: 'human', createdAt: new Date() });
    store.setActive('coder', '1.0.0');
    store.saveExperiment({ agentSlug: 'coder', control: '1.0.0', candidate: '1.1.0', trafficPct: 0.3, startedAt: new Date() });

    const router = new PromptExperimentRouter(store);
    const results = Array.from({ length: 1000 }, () => router.resolvePromptForSpawn('coder'));
    const candidateCount = results.filter(r => r.isCandidate).length;

    // Should be approximately 300 ± 50 (3-sigma tolerance)
    expect(candidateCount).toBeGreaterThan(220);
    expect(candidateCount).toBeLessThan(380);
  });
});
```

## 8. Definition of Done

- [ ] `prompt_versions` and `prompt_experiments` SQLite tables created on `agent-db initialize()`
- [ ] `PromptVersionStore.save()` correctly upserts version records
- [ ] `PromptVersionStore.setActive()` closes previous active version and opens new one atomically
- [ ] `PromptVersionStore.getActive()` returns the correct single active version
- [ ] Spawn handler in `agent-tools.ts` calls `PromptExperimentRouter.resolvePromptForSpawn()` and stores `prompt_version` in agent metadata
- [ ] Traffic splitter distributes spawns within ±5% of declared `trafficPct` over 1000 samples
- [ ] `prompt version list` CLI command shows all versions with quality scores
- [ ] `prompt version rollback` promotes the immediately prior active version
- [ ] `prompt experiment start` saves an experiment and routes traffic on next spawn
- [ ] `prompt experiment stop --promote-winner` concludes the experiment and promotes the winner
- [ ] All unit tests pass using an in-memory SQLite database
- [ ] `tsc --noEmit` passes across all new and modified files
