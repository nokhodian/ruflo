# Task 45: Procedural Memory — Learn from Successful Executions

**Priority:** Phase 5 — Future
**Effort:** High
**Depends on:** (none — builds on existing AgentDB + HNSW infrastructure and background workers system)
**Blocks:** (none)

---

## 1. Current State

Skills in ruflo are static YAML/markdown definitions in `.agents/skills/`. Agents cannot learn new procedures from successful runs. There is no mechanism to extract action sequences from execution history and encode them as reusable skill definitions.

Relevant files:

- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/index.ts` — background worker registry; 12 workers defined (`ultralearn`, `optimize`, `audit`, `map`, etc.). No `procedure-extractor` worker exists.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB backend; stores memories but has no action-sequence schema or skill-writing logic.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/` — memory module root; no `procedural/` directory.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/session-hook.ts` — `post-task` hook stores task completion events but does not extract action sequences.
- `.agents/skills/` directory (relative to project root) — static skill files; no `learned/` subdirectory.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts` — hooks CLI; no `skills` or `procedure` subcommand.

---

## 2. Gap Analysis

**What is missing:**

1. No `Action` record schema — tool calls within an agent run are not structured in a queryable format.
2. No `ActionSequenceExtractor` — no process to identify repeated successful action sequences across runs.
3. No `LearnedSkill` schema or file format — extracted procedures have no target representation.
4. No `ProcedureExtractorWorker` — no background worker to periodically mine execution history.
5. No `.agents/skills/learned/` directory — learned skills have no storage location separate from hand-authored ones.
6. No HNSW indexing of learned skills by trigger description — cannot retrieve relevant skills at task start.
7. No quality threshold filter — low-quality or one-off runs would pollute the skill library without a minimum `successCount` and `avgQualityScore` gate.

**Concrete failure modes:**

- An agent successfully executes a complex 8-step database migration procedure three times in a week. Each time it re-derives the procedure from scratch, wasting ~2,000 tokens per run.
- A new agent type spawned for a similar migration task has no access to the proven procedure and makes a different error than the experienced agent would have avoided.
- The skills library never grows despite hundreds of successful runs; institutional knowledge exists only in HNSW memory as unstructured blobs.
- Skill triggering is purely semantic (HNSW similarity on task description) without any procedural template to guide execution steps, leading to inconsistent execution.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/memory/src/procedural/action-record.ts` | `Action` schema — structured record of a single tool call + outcome |
| `v3/@claude-flow/memory/src/procedural/action-sequence-extractor.ts` | Extracts repeated action sequences from run history |
| `v3/@claude-flow/memory/src/procedural/learned-skill.ts` | `LearnedSkill` interface + serializer to markdown frontmatter format |
| `v3/@claude-flow/memory/src/procedural/skill-registry.ts` | Reads, writes, and HNSW-indexes learned skills |
| `v3/@claude-flow/memory/src/procedural/procedure-extractor-worker.ts` | Background worker — mines history, calls extractor, writes skills |
| `v3/@claude-flow/memory/src/procedural/types.ts` | Shared types: `ActionOutcome`, `ExtractionConfig`, `SkillTrigger` |
| `v3/@claude-flow/memory/src/procedural/index.ts` | Barrel export |
| `v3/@claude-flow/memory/src/__tests__/procedural-memory.test.ts` | Unit tests |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `v3/@claude-flow/hooks/src/workers/index.ts` | Register `ProcedureExtractorWorker` as the 13th background worker with priority `low` and schedule `0 3 * * *` (daily at 3 AM). |
| `v3/@claude-flow/hooks/src/workers/session-hook.ts` | In `post-task` hook, call `ActionRecordStore.recordAction(agentId, toolName, input, output, durationMs, success)` for every tool call completion. |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `storeActionRecord(record: ActionRecord)` and `queryActionRecords(filter: ActionFilter): ActionRecord[]` methods. Use namespace `action-records:*`. |
| `v3/@claude-flow/cli/src/commands/hooks.ts` | Add `hooks skills list` and `hooks skills inspect --skill-id <id>` subcommands to browse learned skills. |
| `v3/@claude-flow/cli/src/commands/agent.ts` | In agent spawn flow, call `SkillRegistry.findRelevantSkills(taskDescription)` and prepend the top-1 skill's `actionSequence` as a reference plan if confidence > 0.8. |

---

## 5. Implementation Steps

**Step 1 — Define procedural memory types**

Create `v3/@claude-flow/memory/src/procedural/types.ts`:

```typescript
export type ActionOutcome = 'success' | 'failure' | 'partial';

export interface ActionRecord {
  recordId: string;
  runId: string;            // task/session ID this action belongs to
  agentId: string;
  agentSlug: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: string;
  outcome: ActionOutcome;
  durationMs: number;
  qualityScore?: number;    // 0.0–1.0, set by post-run evaluator
  timestamp: Date;
}

export interface ExtractionConfig {
  minSuccessCount: number;     // default: 3
  minAvgQualityScore: number;  // default: 0.75
  maxSequenceLength: number;   // default: 12
  lookbackDays: number;        // default: 30
  minSimilarityForGrouping: number; // HNSW cosine threshold, default: 0.85
}

export interface SkillTrigger {
  pattern: string;   // regex or semantic description
  mode: 'exact' | 'semantic';
  minConfidence: number;
}
```

**Step 2 — Implement `ActionRecord` store helpers**

Create `v3/@claude-flow/memory/src/procedural/action-record.ts`. See Key Code Templates.

**Step 3 — Implement `ActionSequenceExtractor`**

Create `v3/@claude-flow/memory/src/procedural/action-sequence-extractor.ts`. See Key Code Templates.

**Step 4 — Implement `LearnedSkill` serializer**

Create `v3/@claude-flow/memory/src/procedural/learned-skill.ts`. See Key Code Templates.

**Step 5 — Implement `SkillRegistry`**

Create `v3/@claude-flow/memory/src/procedural/skill-registry.ts`. See Key Code Templates.

**Step 6 — Implement `ProcedureExtractorWorker`**

Create `v3/@claude-flow/memory/src/procedural/procedure-extractor-worker.ts`. See Key Code Templates.

**Step 7 — Record actions in `post-task` hook**

Edit `v3/@claude-flow/hooks/src/workers/session-hook.ts`. After each tool call completion event:

```typescript
import { ActionRecordStore } from '../../memory/src/procedural/action-record.js';

// In post-tool-call handler:
await ActionRecordStore.record({
  recordId: randomBytes(8).toString('hex'),
  runId: context.taskId,
  agentId: context.agentId,
  agentSlug: context.agentSlug,
  toolName: event.toolName,
  toolInput: event.toolInput,
  toolOutput: event.toolOutput,
  outcome: event.success ? 'success' : 'failure',
  durationMs: event.durationMs,
  timestamp: new Date(),
});
```

**Step 8 — Register worker**

Edit `v3/@claude-flow/hooks/src/workers/index.ts`. Add to worker registry:

```typescript
import { ProcedureExtractorWorker } from '../../memory/src/procedural/procedure-extractor-worker.js';

workers.register({
  name: 'procedure-extractor',
  priority: 'low',
  schedule: '0 3 * * *',   // daily at 3 AM
  worker: new ProcedureExtractorWorker({
    minSuccessCount: 3,
    minAvgQualityScore: 0.75,
    maxSequenceLength: 12,
    lookbackDays: 30,
    minSimilarityForGrouping: 0.85,
  }),
});
```

**Step 9 — CLI skill browser**

Edit `v3/@claude-flow/cli/src/commands/hooks.ts`. Add:

```typescript
.command('skills list')
.description('List all learned procedural skills')
.option('--agent-slug <slug>', 'Filter by agent slug')
.option('--min-quality <score>', 'Minimum quality score (0–1)', '0.75')
.action(async (opts) => {
  const registry = new SkillRegistry();
  const skills = await registry.list(opts);
  skills.forEach(s => console.log(`${s.skillId}: ${s.name} (uses: ${s.successCount}, quality: ${s.avgQualityScore.toFixed(2)})`));
})

.command('skills inspect')
.requiredOption('--skill-id <id>', 'Skill ID')
.action(async (opts) => {
  const registry = new SkillRegistry();
  const skill = await registry.get(opts.skillId);
  if (!skill) { console.error('Not found'); process.exit(1); }
  console.log(JSON.stringify(skill, null, 2));
})
```

**Step 10 — Write tests**

Create `v3/@claude-flow/memory/src/__tests__/procedural-memory.test.ts`. See Testing Strategy.

---

## 6. Key Code Templates

### `action-record.ts`

```typescript
import { randomBytes } from 'crypto';
import type { ActionRecord, ActionOutcome } from './types.js';

export class ActionRecordStore {
  static async record(record: ActionRecord): Promise<void> {
    // Persist to AgentDB namespace 'action-records:{agentSlug}:{runId}:{recordId}'
    // Implementation calls agentdb.store(key, record)
    void record;
  }

  static async queryByAgentSlug(
    agentSlug: string,
    lookbackDays: number = 30
  ): Promise<ActionRecord[]> {
    const cutoff = new Date(Date.now() - lookbackDays * 86_400_000);
    // Implementation: agentdb.listKeys('action-records:' + agentSlug + ':')
    //   then filter by timestamp >= cutoff
    void agentSlug; void cutoff;
    return [];
  }

  static async getRunSequence(runId: string): Promise<ActionRecord[]> {
    // Returns all action records for a given run, sorted by timestamp
    void runId;
    return [];
  }
}
```

### `action-sequence-extractor.ts`

```typescript
import type { ActionRecord, ExtractionConfig } from './types.js';

export interface ActionSequenceGroup {
  representativeSequence: ActionRecord[];
  occurrences: string[];     // runIds
  successCount: number;
  avgQualityScore: number;
  triggerDescriptions: string[];
}

export class ActionSequenceExtractor {
  constructor(private config: ExtractionConfig) {}

  /**
   * Groups action records by similarity of their tool-call sequences.
   * Returns groups that meet the minimum success threshold.
   */
  async extract(allRecords: ActionRecord[]): Promise<ActionSequenceGroup[]> {
    // 1. Group by agentSlug
    const bySlug = this.groupBySlug(allRecords);

    const groups: ActionSequenceGroup[] = [];

    for (const [slug, records] of bySlug.entries()) {
      // 2. Group runs by tool sequence fingerprint
      const runGroups = this.groupByToolSequence(records);

      for (const [fingerprint, runIds] of runGroups.entries()) {
        if (runIds.length < this.config.minSuccessCount) continue;

        // 3. Get representative sequence (most recent successful run)
        const repRunId = runIds[runIds.length - 1];
        const repSequence = records
          .filter(r => r.runId === repRunId)
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        if (repSequence.length > this.config.maxSequenceLength) continue;

        const qualityScores = records
          .filter(r => runIds.includes(r.runId) && r.qualityScore !== undefined)
          .map(r => r.qualityScore!);
        const avgQuality = qualityScores.length > 0
          ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
          : 0;

        if (avgQuality < this.config.minAvgQualityScore) continue;

        groups.push({
          representativeSequence: repSequence,
          occurrences: runIds,
          successCount: runIds.length,
          avgQualityScore: avgQuality,
          triggerDescriptions: [],
        });
      }
    }

    return groups;
  }

  private groupBySlug(records: ActionRecord[]): Map<string, ActionRecord[]> {
    const map = new Map<string, ActionRecord[]>();
    for (const r of records) {
      const list = map.get(r.agentSlug) ?? [];
      list.push(r);
      map.set(r.agentSlug, list);
    }
    return map;
  }

  private groupByToolSequence(records: ActionRecord[]): Map<string, string[]> {
    // Fingerprint: sorted list of tool names per run
    const runToTools = new Map<string, string[]>();
    for (const r of records) {
      const tools = runToTools.get(r.runId) ?? [];
      tools.push(r.toolName);
      runToTools.set(r.runId, tools);
    }

    const fingerprintToRuns = new Map<string, string[]>();
    for (const [runId, tools] of runToTools.entries()) {
      const fp = tools.join('→');
      const runs = fingerprintToRuns.get(fp) ?? [];
      runs.push(runId);
      fingerprintToRuns.set(fp, runs);
    }

    return fingerprintToRuns;
  }
}
```

### `learned-skill.ts`

```typescript
import { randomBytes } from 'crypto';
import type { ActionRecord, SkillTrigger } from './types.js';

export interface LearnedSkill {
  skillId: string;
  name: string;
  agentSlug: string;
  trigger: SkillTrigger;
  actionSequence: ActionRecord[];
  successCount: number;
  avgQualityScore: number;
  sourceRunIds: string[];
  createdAt: Date;
  lastUpdatedAt: Date;
  version: number;
}

export class LearnedSkillSerializer {
  /**
   * Serializes a LearnedSkill to a markdown file compatible with
   * the existing .agents/skills/ frontmatter format.
   */
  static toMarkdown(skill: LearnedSkill): string {
    const steps = skill.actionSequence
      .map((a, i) => `${i + 1}. **${a.toolName}** — ${JSON.stringify(a.toolInput).slice(0, 120)}`)
      .join('\n');

    return `---
skill_id: ${skill.skillId}
name: ${skill.name}
agent_slug: ${skill.agentSlug}
version: ${skill.version}
success_count: ${skill.successCount}
avg_quality_score: ${skill.avgQualityScore.toFixed(3)}
trigger_pattern: "${skill.trigger.pattern}"
trigger_mode: ${skill.trigger.mode}
created_at: ${skill.createdAt.toISOString()}
last_updated_at: ${skill.lastUpdatedAt.toISOString()}
source_run_ids: [${skill.sourceRunIds.map(id => `"${id}"`).join(', ')}]
---

# Learned Skill: ${skill.name}

**Agent:** \`${skill.agentSlug}\`  
**Success Rate:** ${skill.successCount} confirmed runs  
**Quality Score:** ${(skill.avgQualityScore * 100).toFixed(1)}%

## Action Sequence

${steps}
`;
  }

  static create(
    name: string,
    agentSlug: string,
    triggerPattern: string,
    actionSequence: ActionRecord[],
    successCount: number,
    avgQualityScore: number,
    sourceRunIds: string[]
  ): LearnedSkill {
    return {
      skillId: `ls-${randomBytes(6).toString('hex')}`,
      name,
      agentSlug,
      trigger: { pattern: triggerPattern, mode: 'semantic', minConfidence: 0.8 },
      actionSequence,
      successCount,
      avgQualityScore,
      sourceRunIds,
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
      version: 1,
    };
  }
}
```

### `procedure-extractor-worker.ts`

```typescript
import { ActionRecordStore } from './action-record.js';
import { ActionSequenceExtractor } from './action-sequence-extractor.js';
import { LearnedSkillSerializer } from './learned-skill.js';
import { SkillRegistry } from './skill-registry.js';
import type { ExtractionConfig } from './types.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export class ProcedureExtractorWorker {
  private extractor: ActionSequenceExtractor;
  private registry: SkillRegistry;

  constructor(private config: ExtractionConfig) {
    this.extractor = new ActionSequenceExtractor(config);
    this.registry = new SkillRegistry();
  }

  async run(): Promise<void> {
    console.log('[ProcedureExtractorWorker] Starting extraction run...');

    // 1. Load all action records from the lookback window
    const slugs = await this.registry.getActiveAgentSlugs();
    const allRecords = (
      await Promise.all(slugs.map(s => ActionRecordStore.queryByAgentSlug(s, this.config.lookbackDays)))
    ).flat();

    console.log(`[ProcedureExtractorWorker] Loaded ${allRecords.length} action records`);

    // 2. Extract action sequence groups
    const groups = await this.extractor.extract(allRecords);
    console.log(`[ProcedureExtractorWorker] Found ${groups.length} candidate skill groups`);

    // 3. Convert to LearnedSkill and write to disk
    const learnedDir = join(process.cwd(), '.agents', 'skills', 'learned');
    await mkdir(learnedDir, { recursive: true });

    let written = 0;
    for (const group of groups) {
      const agentSlug = group.representativeSequence[0]?.agentSlug ?? 'unknown';
      const toolNames = group.representativeSequence.map(a => a.toolName).join('-');
      const name = `auto-${agentSlug}-${toolNames.slice(0, 40)}`.replace(/[^a-z0-9-]/gi, '-');
      const triggerPattern = group.triggerDescriptions[0] ?? agentSlug;

      const skill = LearnedSkillSerializer.create(
        name,
        agentSlug,
        triggerPattern,
        group.representativeSequence,
        group.successCount,
        group.avgQualityScore,
        group.occurrences
      );

      // Check if this skill already exists (by fingerprint)
      const existing = await this.registry.findByFingerprint(skill);
      if (existing) {
        await this.registry.update(existing.skillId, { ...skill, version: existing.version + 1 });
      } else {
        const md = LearnedSkillSerializer.toMarkdown(skill);
        const filePath = join(learnedDir, `${skill.skillId}.md`);
        await writeFile(filePath, md, 'utf8');
        await this.registry.register(skill);
        written++;
      }
    }

    console.log(`[ProcedureExtractorWorker] Wrote ${written} new skills to .agents/skills/learned/`);
  }
}
```

---

## 7. Testing Strategy

File: `v3/@claude-flow/memory/src/__tests__/procedural-memory.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { ActionSequenceExtractor } from '../procedural/action-sequence-extractor.js';
import { LearnedSkillSerializer } from '../procedural/learned-skill.js';

const makeRecord = (runId: string, agentSlug: string, toolName: string, qualityScore = 0.9): any => ({
  recordId: `r-${Math.random()}`,
  runId,
  agentId: 'a1',
  agentSlug,
  toolName,
  toolInput: {},
  outcome: 'success',
  durationMs: 100,
  qualityScore,
  timestamp: new Date(),
});

describe('ActionSequenceExtractor', () => {
  const extractor = new ActionSequenceExtractor({
    minSuccessCount: 3,
    minAvgQualityScore: 0.75,
    maxSequenceLength: 12,
    lookbackDays: 30,
    minSimilarityForGrouping: 0.85,
  });

  it('extracts a skill group when the same sequence appears 3+ times', async () => {
    const records = [
      ...['run1', 'run2', 'run3'].flatMap(runId => [
        makeRecord(runId, 'coder', 'Read'),
        makeRecord(runId, 'coder', 'Edit'),
        makeRecord(runId, 'coder', 'Bash'),
      ]),
    ];
    const groups = await extractor.extract(records);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].successCount).toBe(3);
  });

  it('rejects groups below minSuccessCount', async () => {
    const records = [
      makeRecord('only-run', 'coder', 'Read'),
      makeRecord('only-run', 'coder', 'Edit'),
    ];
    const groups = await extractor.extract(records);
    expect(groups).toHaveLength(0);
  });

  it('rejects groups below minAvgQualityScore', async () => {
    const records = [
      ...['r1', 'r2', 'r3'].flatMap(runId => [
        makeRecord(runId, 'coder', 'Read', 0.5),
        makeRecord(runId, 'coder', 'Edit', 0.5),
      ]),
    ];
    const groups = await extractor.extract(records);
    expect(groups).toHaveLength(0);
  });

  it('rejects sequences exceeding maxSequenceLength', async () => {
    const tooManyTools = Array.from({ length: 15 }, (_, i) => `Tool${i}`);
    const records = ['r1', 'r2', 'r3'].flatMap(runId =>
      tooManyTools.map(t => makeRecord(runId, 'coder', t))
    );
    const groups = await extractor.extract(records);
    expect(groups).toHaveLength(0);
  });
});

describe('LearnedSkillSerializer', () => {
  it('serializes to valid YAML frontmatter markdown', () => {
    const skill = LearnedSkillSerializer.create(
      'test-skill', 'coder', 'edit typescript files',
      [makeRecord('r1', 'coder', 'Read'), makeRecord('r1', 'coder', 'Edit')],
      3, 0.88, ['r1', 'r2', 'r3']
    );
    const md = LearnedSkillSerializer.toMarkdown(skill);
    expect(md).toContain('skill_id:');
    expect(md).toContain('success_count: 3');
    expect(md).toContain('avg_quality_score: 0.880');
    expect(md).toContain('## Action Sequence');
    expect(md).toContain('1. **Read**');
    expect(md).toContain('2. **Edit**');
  });
});
```

**Integration test:** Run `ProcedureExtractorWorker` against a seeded AgentDB with 5 runs of the same 4-tool sequence (all quality > 0.8). Assert `.agents/skills/learned/` contains at least one new `.md` file with correct frontmatter. Assert skill is retrievable via `SkillRegistry.findRelevantSkills('edit typescript files')`.

---

## 8. Definition of Done

- [ ] `ActionRecord` schema defined and serializable to/from AgentDB.
- [ ] `post-task` hook records every tool call as an `ActionRecord` in `action-records:*` namespace.
- [ ] `ActionSequenceExtractor` groups repeated sequences and filters by `minSuccessCount` and `minAvgQualityScore`.
- [ ] `LearnedSkillSerializer.toMarkdown` produces valid YAML-frontmatter markdown compatible with existing `.agents/skills/` format.
- [ ] `ProcedureExtractorWorker` writes new skill files to `.agents/skills/learned/` without overwriting hand-authored skills in `.agents/skills/`.
- [ ] Worker registered in `workers/index.ts` as worker #13 with daily schedule.
- [ ] `hooks skills list` and `hooks skills inspect` CLI subcommands work.
- [ ] `SkillRegistry.findRelevantSkills(taskDescription)` returns top-1 match above 0.8 cosine similarity.
- [ ] Agent spawn flow prepends top skill's action sequence as plan when relevance > 0.8.
- [ ] All unit tests in `procedural-memory.test.ts` pass.
- [ ] Zero duplicate skill IDs after 10 consecutive extractor runs on the same dataset.
- [ ] TypeScript compiles with zero errors.
