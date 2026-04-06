# Task 26: Dynamic System Prompt Assembly
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** Medium  
**Depends on:** Task 23 (Shared Instructions — provides `ProjectConventionsProvider`), Task 24 (Prompt Versioning — active prompt is the base)  
**Blocks:** none

## 1. Current State

Agent system prompts are static strings in `.claude/agents/**/*.md` files with no runtime adaptation to project state.

| Component | Location | Current Behavior |
|---|---|---|
| System prompt loading | `v3/mcp/tools/agent-tools.ts` | Reads `.md` file; yields static string |
| Shared instructions | Task 23 creates this | Prepended as a static block |
| Git state | Not injected | Agents do not know current branch, recent commits |
| Task history | Not injected | Agents cannot reference recent relevant runs |
| User preferences | Not injected | No per-session preference context |
| Token budget | Not managed | All providers append at maximum possible length |
| Context providers | No implementation | No composable provider system exists |

**Concrete failure mode:** The `engineering-code-reviewer` agent reviews a PR and produces suggestions that duplicate work that was already done on a different branch three commits ago. The agent has no access to recent git history. Token budget is also wasted: the agent's full static prompt is always included even when simpler tasks don't need the security review sections (900 tokens wasted on every lint-only review request).

## 2. Gap Analysis

- No `ContextProvider` interface — no abstraction for pluggable prompt sections.
- No `GitStateProvider` — agents cannot see current branch, recent commits, or changed files.
- No `TaskHistoryProvider` — agents cannot see recent relevant runs from episodic memory.
- No `ProjectConventionsProvider` — shared instructions are not a formal context provider.
- No `UserPreferencesProvider` — no per-session preferences injected.
- No token budget allocation — providers do not respect a budget cap per section.
- No priority-based insertion ordering — lower-priority providers should be truncated first.
- No frontmatter declaration of which providers an agent uses.

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/cli/src/context/context-provider.ts` | `ContextProvider` interface + `RunContext` type |
| `v3/@claude-flow/cli/src/context/git-state-provider.ts` | Injects current branch, recent commits, changed files |
| `v3/@claude-flow/cli/src/context/task-history-provider.ts` | Injects recent relevant runs from AgentDB episodic memory |
| `v3/@claude-flow/cli/src/context/project-conventions-provider.ts` | Wraps shared instructions (Task 23) as a formal provider |
| `v3/@claude-flow/cli/src/context/user-preferences-provider.ts` | Injects per-session user preferences from session config |
| `v3/@claude-flow/cli/src/context/prompt-assembler.ts` | Assembles providers in priority order; enforces token budgets; returns final prompt string |
| `tests/context/prompt-assembler.test.ts` | Unit tests for assembly ordering, budget truncation, provider errors |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/mcp/tools/agent-tools.ts` | Replace static prompt loading with `PromptAssembler.assemble(agentSlug, runContext)` call | Every spawn uses dynamic assembly |
| All 230+ agent `.md` files (frontmatter) | Add optional `context_providers: [list]` field to the `capability` block | Allows per-agent declaration of which providers to activate |
| `v3/@claude-flow/cli/src/agents/shared-instructions-loader.ts` (Task 23) | Expose `SharedInstructionsLoader.getSharedInstructions()` for use by `ProjectConventionsProvider` | Reuse without duplication |

## 5. Implementation Steps

1. **Define `ContextProvider` and `RunContext`** — In `context-provider.ts`, define the interface and the context object that providers receive. `RunContext` includes: `agentSlug`, `taskDescription`, `sessionId`, `swarmId`, `metadata`.

2. **Build `GitStateProvider`** — Calls `git branch --show-current`, `git log --oneline -10`, `git diff --name-only HEAD` via Bash (cached for the duration of the spawn). Formats as a compact markdown section. Gracefully returns empty string if not in a git repo.

3. **Build `TaskHistoryProvider`** — Queries AgentDB for the 3 most recent completed tasks with embeddings similar to the current task description (using HNSW similarity). Returns a compact summary per task: task description, agent, outcome, and key output snippet.

4. **Build `ProjectConventionsProvider`** — Wraps `SharedInstructionsLoader.getSharedInstructions()`. Priority = 100 (highest). This is always included unless explicitly excluded.

5. **Build `UserPreferencesProvider`** — Reads from the current session config in AgentDB. Formats preferences as a short list. Priority = 90.

6. **Build `PromptAssembler`** — The central assembler:
   - Accepts a list of `ContextProvider` instances (declared in agent frontmatter or default set).
   - Calls each provider's `provide(runContext)` concurrently.
   - Sorts results by `priority` descending.
   - Truncates lower-priority sections first until total token count fits within `maxTotalTokens`.
   - Concatenates sections with clear headers.
   - Appends the base agent system prompt (from `PromptVersionStore.getActive()` or file fallback).

7. **Update agent frontmatter schema** — Define the `context_providers` field type. Supported values: `'git-state'`, `'task-history'`, `'project-conventions'`, `'user-preferences'`. Default (if omitted): `['project-conventions']`.

8. **Update spawn handler** — In `agent-tools.ts`, build `RunContext` from spawn metadata, create the provider list from agent frontmatter, call `PromptAssembler.assemble()`, use the result as the final system prompt.

9. **Write tests** — Cover: providers called concurrently, budget truncation removes lowest-priority first, provider error does not abort assembly (graceful degradation), empty provider list uses only base prompt.

## 6. Key Code Templates

```typescript
// v3/@claude-flow/cli/src/context/context-provider.ts

export interface RunContext {
  agentSlug:       string;
  taskDescription: string;
  sessionId:       string;
  swarmId?:        string;
  workingDir?:     string;
  metadata:        Record<string, unknown>;
}

export interface ContextSection {
  name:        string;
  content:     string;
  tokenCount:  number;   // approximate tokens (content.length / 4 as heuristic)
  priority:    number;   // higher = inserted first and truncated last
  required:    boolean;  // required sections are never truncated
}

export interface ContextProvider {
  name:        string;
  priority:    number;   // 0–100; higher = higher priority
  maxTokens:   number;   // max token budget for this section (default: 500)
  required:    boolean;  // default: false
  provide(ctx: RunContext): Promise<string>;
}

export abstract class BaseContextProvider implements ContextProvider {
  abstract name: string;
  abstract priority: number;
  maxTokens = 500;
  required = false;

  abstract provide(ctx: RunContext): Promise<string>;

  protected truncateToTokens(text: string, maxTokens: number): string {
    const approxChars = maxTokens * 4;
    if (text.length <= approxChars) return text;
    return text.slice(0, approxChars) + '\n... [truncated]';
  }
}
```

```typescript
// v3/@claude-flow/cli/src/context/git-state-provider.ts
import { execSync } from 'child_process';
import { BaseContextProvider, RunContext } from './context-provider.js';

export class GitStateProvider extends BaseContextProvider {
  name     = 'git-state';
  priority = 60;
  maxTokens = 300;

  async provide(ctx: RunContext): Promise<string> {
    try {
      const cwd = ctx.workingDir ?? process.cwd();
      const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();
      const recentLog = execSync('git log --oneline -5', { cwd, encoding: 'utf-8' }).trim();
      const changedFiles = execSync('git diff --name-only HEAD', { cwd, encoding: 'utf-8' }).trim();

      const content = `## Current Git State
**Branch:** ${branch}

**Recent commits:**
${recentLog}

**Changed files:**
${changedFiles || '(none)'}`;

      return this.truncateToTokens(content, this.maxTokens);
    } catch {
      return '## Current Git State\n(Not available — not a git repository or git not installed)';
    }
  }
}
```

```typescript
// v3/@claude-flow/cli/src/context/task-history-provider.ts
import { BaseContextProvider, RunContext } from './context-provider.js';

export class TaskHistoryProvider extends BaseContextProvider {
  name     = 'task-history';
  priority = 50;
  maxTokens = 600;

  constructor(private agentDb: AgentDB) { super(); }

  async provide(ctx: RunContext): Promise<string> {
    try {
      const similar = await this.agentDb.semanticSearch(
        ctx.taskDescription,
        { namespace: 'task-results', limit: 3, minScore: 0.7 }
      );

      if (similar.length === 0) return '';

      const lines = similar.map((r, i) => {
        const meta = r.metadata as Record<string, unknown>;
        return `### Recent Task ${i + 1}
- **Agent:** ${meta.agentSlug ?? 'unknown'}
- **Task:** ${String(meta.taskDescription ?? '').slice(0, 100)}
- **Outcome:** ${meta.status ?? 'unknown'}
- **Key output:** ${String(meta.outputSnippet ?? '').slice(0, 200)}`;
      }).join('\n\n');

      return `## Recent Relevant Tasks\n\n${this.truncateToTokens(lines, this.maxTokens)}`;
    } catch {
      return '';
    }
  }
}
```

```typescript
// v3/@claude-flow/cli/src/context/prompt-assembler.ts
import { ContextProvider, ContextSection, RunContext } from './context-provider.js';

export interface AssemblyConfig {
  maxTotalTokens:    number;   // default: 6000 (leaves room for conversation)
  basePromptTokens:  number;   // estimated tokens for the base agent prompt
  providers:         ContextProvider[];
}

export interface AssembledPrompt {
  content:           string;
  sectionsIncluded:  string[];
  sectionsTruncated: string[];
  sectionsDropped:   string[];
  totalTokenEstimate: number;
}

export class PromptAssembler {
  constructor(private config: AssemblyConfig) {}

  async assemble(basePrompt: string, ctx: RunContext): Promise<AssembledPrompt> {
    const sectionsIncluded: string[] = [];
    const sectionsTruncated: string[] = [];
    const sectionsDropped: string[] = [];

    // Collect from all providers concurrently, with graceful degradation
    const rawSections = await Promise.allSettled(
      this.config.providers.map(async (p): Promise<ContextSection> => ({
        name:       p.name,
        content:    await p.provide(ctx),
        tokenCount: 0, // computed below
        priority:   p.priority,
        required:   p.required,
      }))
    );

    let sections: ContextSection[] = rawSections
      .filter(r => r.status === 'fulfilled' && r.value.content.trim())
      .map(r => {
        const s = (r as PromiseFulfilledResult<ContextSection>).value;
        s.tokenCount = Math.ceil(s.content.length / 4);
        return s;
      })
      .sort((a, b) => b.priority - a.priority);

    // Budget allocation: reserve space for base prompt
    const baseTokens = this.config.basePromptTokens;
    let remaining = this.config.maxTotalTokens - baseTokens;

    const finalSections: ContextSection[] = [];
    for (const section of sections) {
      if (section.tokenCount <= remaining) {
        finalSections.push(section);
        sectionsIncluded.push(section.name);
        remaining -= section.tokenCount;
      } else if (section.required) {
        // Truncate required sections to fit
        const maxChars = remaining * 4;
        const truncated: ContextSection = {
          ...section,
          content:    section.content.slice(0, maxChars) + '\n... [truncated to fit token budget]',
          tokenCount: remaining,
        };
        finalSections.push(truncated);
        sectionsTruncated.push(section.name);
        remaining = 0;
      } else {
        sectionsDropped.push(section.name);
      }
    }

    // Assemble final prompt
    const sectionText = finalSections
      .map(s => s.content)
      .join('\n\n');

    const separator = '\n\n---\n<!-- CONTEXT SECTIONS END — BASE AGENT INSTRUCTIONS FOLLOW -->\n\n';
    const content = sectionText + separator + basePrompt;

    return {
      content,
      sectionsIncluded,
      sectionsTruncated,
      sectionsDropped,
      totalTokenEstimate: Math.ceil(content.length / 4),
    };
  }
}
```

### Agent Frontmatter Example

```yaml
---
name: Code Reviewer
version: "2.0.0"
description: Reviews code for quality, security, and adherence to project conventions.
tools: Read, Glob, Grep, WebSearch
capability:
  role: code-reviewer
  goal: Identify issues and improvements in code changes
  task_types:
    - code-review
    - pull-request-review
  context_providers:
    - project-conventions   # always include coding standards
    - git-state             # know what branch/commits are in scope
    - task-history          # avoid duplicate findings from recent reviews
    # user-preferences omitted — not relevant for code review
  model_preference:
    default: sonnet
---
```

### Default Provider Set (when frontmatter has no `context_providers` key)

```typescript
// v3/@claude-flow/cli/src/context/default-providers.ts

export const DEFAULT_PROVIDERS: ContextProvider[] = [
  new ProjectConventionsProvider(),  // always included
];

export const EXTENDED_PROVIDERS: Record<string, ContextProvider> = {
  'git-state':             new GitStateProvider(),
  'task-history':          new TaskHistoryProvider(agentDb),
  'project-conventions':   new ProjectConventionsProvider(),
  'user-preferences':      new UserPreferencesProvider(sessionStore),
};
```

## 7. Testing Strategy

```typescript
// tests/context/prompt-assembler.test.ts
import { PromptAssembler, AssemblyConfig } from '../../v3/@claude-flow/cli/src/context/prompt-assembler.js';
import { ContextProvider, RunContext } from '../../v3/@claude-flow/cli/src/context/context-provider.js';

const makeProvider = (name: string, priority: number, content: string, maxTokens = 500, required = false): ContextProvider => ({
  name, priority, maxTokens, required,
  provide: async () => content,
});

const ctx: RunContext = { agentSlug: 'coder', taskDescription: 'fix bug', sessionId: 's1', metadata: {} };

describe('PromptAssembler', () => {
  it('includes all providers when budget is sufficient', async () => {
    const config: AssemblyConfig = {
      maxTotalTokens: 10000, basePromptTokens: 500,
      providers: [makeProvider('git', 60, 'git content'), makeProvider('history', 50, 'history content')]
    };
    const assembler = new PromptAssembler(config);
    const result = await assembler.assemble('Base prompt', ctx);
    expect(result.sectionsIncluded).toContain('git');
    expect(result.sectionsIncluded).toContain('history');
  });

  it('drops lowest-priority provider when budget is tight', async () => {
    const longContent = 'x'.repeat(4000); // ~1000 tokens
    const config: AssemblyConfig = {
      maxTotalTokens: 1500, basePromptTokens: 1000,
      providers: [
        makeProvider('high', 90, longContent),
        makeProvider('low', 10, longContent),
      ]
    };
    const assembler = new PromptAssembler(config);
    const result = await assembler.assemble('Base prompt', ctx);
    expect(result.sectionsIncluded).toContain('high');
    expect(result.sectionsDropped).toContain('low');
  });

  it('truncates required provider when budget exceeded', async () => {
    const longContent = 'y'.repeat(8000); // ~2000 tokens
    const config: AssemblyConfig = {
      maxTotalTokens: 1200, basePromptTokens: 800,
      providers: [makeProvider('required-section', 100, longContent, 500, true)]
    };
    const assembler = new PromptAssembler(config);
    const result = await assembler.assemble('Base prompt', ctx);
    expect(result.sectionsTruncated).toContain('required-section');
    expect(result.content).toContain('truncated to fit token budget');
  });

  it('gracefully excludes a provider that throws', async () => {
    const brokenProvider: ContextProvider = {
      name: 'broken', priority: 70, maxTokens: 200, required: false,
      provide: async () => { throw new Error('provider failed'); }
    };
    const config: AssemblyConfig = {
      maxTotalTokens: 5000, basePromptTokens: 500,
      providers: [brokenProvider, makeProvider('healthy', 50, 'good content')]
    };
    const assembler = new PromptAssembler(config);
    const result = await assembler.assemble('Base prompt', ctx);
    expect(result.sectionsIncluded).toContain('healthy');
    expect(result.sectionsIncluded).not.toContain('broken');
  });

  it('places base prompt after all context sections', async () => {
    const config: AssemblyConfig = {
      maxTotalTokens: 5000, basePromptTokens: 100,
      providers: [makeProvider('ctx', 50, '## Context Section\nsome context')]
    };
    const assembler = new PromptAssembler(config);
    const result = await assembler.assemble('BASE PROMPT', ctx);
    expect(result.content.indexOf('## Context Section')).toBeLessThan(result.content.indexOf('BASE PROMPT'));
  });
});

describe('GitStateProvider', () => {
  it('returns graceful fallback when not in a git repo', async () => {
    const provider = new GitStateProvider();
    const ctx: RunContext = { agentSlug: 'coder', taskDescription: '', sessionId: '',
      workingDir: '/tmp', metadata: {} };
    const content = await provider.provide(ctx);
    expect(typeof content).toBe('string');
    // Should not throw, should return some content (even if fallback)
  });
});
```

## 8. Definition of Done

- [ ] `ContextProvider` interface with `name`, `priority`, `maxTokens`, `required`, `provide()` defined and typed
- [ ] `GitStateProvider` returns git branch, last 5 commits, changed files; returns fallback string when not in a git repo (does not throw)
- [ ] `TaskHistoryProvider` returns up to 3 semantically similar past tasks from AgentDB
- [ ] `ProjectConventionsProvider` returns content from `SharedInstructionsLoader` (Task 23)
- [ ] `UserPreferencesProvider` returns user preferences from session config
- [ ] `PromptAssembler` calls all providers concurrently via `Promise.allSettled`
- [ ] `PromptAssembler` sorts sections by priority descending before assembly
- [ ] `PromptAssembler` drops lowest-priority sections first when budget is exceeded
- [ ] Required sections are truncated (not dropped) when budget is exceeded
- [ ] Provider that throws does not abort assembly — section is silently excluded
- [ ] Agent frontmatter `context_providers` field is respected; defaults to `['project-conventions']`
- [ ] Spawn handler in `agent-tools.ts` calls `PromptAssembler.assemble()` instead of reading file directly
- [ ] `assembled.sectionsIncluded`, `sectionsTruncated`, `sectionsDropped` are stored in agent metadata
- [ ] All tests pass; `tsc --noEmit` passes
