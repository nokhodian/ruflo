# Task 32: MicroAgent Trigger Patterns
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Low
**Depends on:** Task 30 (Agent Registry — provides `findMicroAgents()`)
**Blocks:** (none)

## 1. Current State

All agent selection in ruflo is explicit: the caller must name the agent type via `agent/spawn` (validated against `ALLOWED_AGENT_TYPES` in `v3/mcp/tools/agent-tools.ts`, lines 33–138) or via the hardcoded routing codes 1–13 in `.agents/skills/agent-coordination/SKILL.md`.

There is no mechanism for an agent to declare "I should be automatically injected when a task description matches a pattern." General-purpose agents (e.g., `coder`, `researcher`) therefore absorb tasks that would be better served by narrow specialists (e.g., `engineering-security-engineer`, `engineering-git-workflow-master`).

The `capability:` block in agent frontmatter exists in some files but carries no `triggers` field. No scanning of task descriptions for implicit specialty signals occurs during swarm initialization or task dispatch.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/**/*.md` — agent frontmatter (no `triggers` field today)
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` lines 152–158; `handleSpawnAgent` function
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/task-tools.ts` — task creation handler
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/agent.ts` — agent spawn command
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/registry.json` — (created by Task 30)

## 2. Gap Analysis

**What's missing:**
1. No `triggers` field in any agent frontmatter — agents cannot declare their specialty keywords
2. No `TriggerScanner` component — task descriptions are never scanned for implicit signals
3. No `inject` mode — specialists cannot be added as co-participants to an already-assigned task
4. No `takeover` mode — specialists cannot claim sole ownership of a task they are uniquely suited for
5. No registry index of microagent triggers — scanning 230+ files on every task dispatch would be too slow

**Concrete failure modes:**
- A task description "Review the JWT validation in auth.ts" is routed to the generic `reviewer` agent rather than `engineering-security-engineer`, which has exactly the expertise needed
- A task mentioning "CVE-2024-1234" spawns a generic `researcher` that lacks CVE database tools, while `engineering-security-engineer` would have handled it correctly
- Docker-related tasks ("Fix the Dockerfile for production") go to `coder` instead of `engineering-devops-automator`

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/cli/src/agents/trigger-scanner.ts` | Scans task descriptions against compiled trigger patterns; returns matches |
| `v3/@claude-flow/cli/src/agents/trigger-index.ts` | Builds and caches an in-memory index of all trigger patterns from `registry.json` |
| `v3/@claude-flow/shared/src/types/trigger.ts` | `TriggerPattern`, `TriggerMatch`, `TriggerScanResult` TypeScript interfaces |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `.claude/agents/engineering/engineering-security-engineer.md` | Add `capability.triggers` frontmatter block (security patterns) |
| `.claude/agents/engineering/engineering-git-workflow-master.md` | Add `capability.triggers` (git patterns) |
| `.claude/agents/engineering/engineering-devops-automator.md` | Add `capability.triggers` (docker/kubernetes patterns) |
| `.claude/agents/engineering/engineering-solidity-smart-contract-engineer.md` | Add `capability.triggers` (solidity/web3 patterns) |
| Additional high-value specialist agent `.md` files (10–15 total) | Add `capability.triggers` |
| `v3/mcp/tools/agent-tools.ts` | In `handleSpawnAgent`, call `TriggerScanner.scan(config.taskDescription)` and log/inject any matched microagents |
| `v3/mcp/tools/task-tools.ts` | In task creation handler, call `TriggerScanner.scan(task.description)` and attach `suggestedMicroAgents` to task metadata |
| `.claude/agents/registry.json` | `registry-builder` (Task 30) already reads `triggers` from frontmatter; regenerating registry captures them |

## 5. Implementation Steps

**Step 1: Define types**

Create `v3/@claude-flow/shared/src/types/trigger.ts`:

```typescript
export interface TriggerPattern {
  pattern: string;          // ECMAScript regex string, e.g. "\\b(auth|jwt)\\b"
  mode: 'inject' | 'takeover';
  // 'inject'   = add this agent as a co-participant alongside the primary agent
  // 'takeover' = this agent becomes the sole handler of the task
}

export interface TriggerMatch {
  agentSlug: string;
  pattern: string;
  mode: 'inject' | 'takeover';
  matchedText: string;      // the substring that triggered the match
}

export interface TriggerScanResult {
  taskDescription: string;
  matches: TriggerMatch[];
  injectAgents: string[];   // deduplicated slugs for 'inject' mode
  takeoverAgent?: string;   // first 'takeover' match (highest priority)
}
```

**Step 2: Add `triggers` frontmatter to high-value specialist agents**

`.claude/agents/engineering/engineering-security-engineer.md` — add to frontmatter:

```yaml
capability:
  triggers:
    - pattern: "\\b(auth|jwt|session|oauth|saml|oidc)\\b"
      mode: "inject"
    - pattern: "CVE-\\d{4}-\\d+"
      mode: "inject"
    - pattern: "\\b(sql.injection|xss|csrf|xxe|ssrf|rce|lfi|rfi)\\b"
      mode: "inject"
    - pattern: "\\b(penetration.test|pentest|vuln(erability)?)\\b"
      mode: "inject"
```

`.claude/agents/engineering/engineering-git-workflow-master.md`:

```yaml
capability:
  triggers:
    - pattern: "\\bgit\\s+(blame|log|rebase|bisect|cherry.pick|stash)\\b"
      mode: "inject"
    - pattern: "\\b(merge.conflict|pull.request|branch.strategy|gitflow)\\b"
      mode: "inject"
```

`.claude/agents/engineering/engineering-devops-automator.md`:

```yaml
capability:
  triggers:
    - pattern: "\\b(dockerfile|docker.compose|docker.image|docker.container)\\b"
      mode: "inject"
    - pattern: "\\b(kubernetes|k8s|helm|pod|deployment.yaml)\\b"
      mode: "inject"
    - pattern: "\\b(ci.?cd|github.actions|jenkins|pipeline)\\b"
      mode: "inject"
```

`.claude/agents/engineering/engineering-solidity-smart-contract-engineer.md`:

```yaml
capability:
  triggers:
    - pattern: "\\b(solidity|\\.sol|smart.contract|web3|ethers?|hardhat|truffle|foundry)\\b"
      mode: "takeover"
```

**Step 3: Build trigger index**

Create `v3/@claude-flow/cli/src/agents/trigger-index.ts`:

```typescript
import type { TriggerPattern } from '@claude-flow/shared/src/types/trigger.js';
import type { AgentRegistry, AgentRegistryEntry } from '@claude-flow/shared/src/types/agent-registry.js';
import { readFile } from 'fs/promises';

interface CompiledTrigger {
  agentSlug: string;
  regex: RegExp;
  mode: 'inject' | 'takeover';
  rawPattern: string;
}

export class TriggerIndex {
  private compiled: CompiledTrigger[] = [];

  async load(registryPath = '.claude/agents/registry.json'): Promise<void> {
    const raw = await readFile(registryPath, 'utf-8');
    const registry: AgentRegistry = JSON.parse(raw);
    this.compiled = [];

    for (const agent of registry.agents) {
      if (!agent.triggers || agent.deprecated) continue;
      for (const trigger of agent.triggers) {
        try {
          this.compiled.push({
            agentSlug: agent.slug,
            regex: new RegExp(trigger.pattern, 'i'),
            mode: trigger.mode,
            rawPattern: trigger.pattern,
          });
        } catch (e) {
          console.warn(`[TriggerIndex] Invalid regex for ${agent.slug}: ${trigger.pattern}`);
        }
      }
    }
  }

  get size(): number { return this.compiled.length; }
}
```

**Step 4: Build trigger scanner**

Create `v3/@claude-flow/cli/src/agents/trigger-scanner.ts`:

```typescript
import type { TriggerScanResult, TriggerMatch } from '@claude-flow/shared/src/types/trigger.js';
import { TriggerIndex } from './trigger-index.js';

let sharedIndex: TriggerIndex | null = null;

export async function getSharedTriggerIndex(): Promise<TriggerIndex> {
  if (!sharedIndex) {
    sharedIndex = new TriggerIndex();
    await sharedIndex.load();
  }
  return sharedIndex;
}

export class TriggerScanner {
  constructor(private index: TriggerIndex) {}

  scan(taskDescription: string): TriggerScanResult {
    const matches: TriggerMatch[] = [];
    const seen = new Set<string>(); // deduplicate by agentSlug

    for (const compiled of (this.index as any).compiled as any[]) {
      if (seen.has(compiled.agentSlug)) continue;
      const match = compiled.regex.exec(taskDescription);
      if (match) {
        seen.add(compiled.agentSlug);
        matches.push({
          agentSlug: compiled.agentSlug,
          pattern: compiled.rawPattern,
          mode: compiled.mode,
          matchedText: match[0],
        });
      }
    }

    const injectAgents = [...new Set(
      matches.filter(m => m.mode === 'inject').map(m => m.agentSlug)
    )];
    // First takeover match wins
    const takeoverMatch = matches.find(m => m.mode === 'takeover');

    return {
      taskDescription,
      matches,
      injectAgents,
      takeoverAgent: takeoverMatch?.agentSlug,
    };
  }
}

/** Convenience function for one-shot scanning */
export async function scanTaskDescription(description: string): Promise<TriggerScanResult> {
  const index = await getSharedTriggerIndex();
  const scanner = new TriggerScanner(index);
  return scanner.scan(description);
}
```

**Step 5: Integrate into agent spawn handler**

In `v3/mcp/tools/agent-tools.ts`, modify `handleSpawnAgent` to scan the task description and log microagent suggestions:

```typescript
import { scanTaskDescription } from '../../@claude-flow/cli/src/agents/trigger-scanner.js';

async function handleSpawnAgent(input: SpawnAgentInput, ctx: ToolContext) {
  // ... existing spawn logic ...

  // MicroAgent trigger scan (Task 32)
  if (input.config?.taskDescription) {
    const triggerResult = await scanTaskDescription(input.config.taskDescription);
    if (triggerResult.matches.length > 0) {
      ctx.logger?.info(`[MicroAgent] Trigger matches for task: ${
        triggerResult.matches.map(m => `${m.agentSlug}(${m.mode})`).join(', ')
      }`);
      // Attach to result so orchestrator can act on suggestions
      (result as any).microAgentSuggestions = triggerResult;
    }
  }

  return result;
}
```

**Step 6: Integrate into task creation**

In `v3/mcp/tools/task-tools.ts`, scan task description on creation:

```typescript
import { scanTaskDescription } from '../../@claude-flow/cli/src/agents/trigger-scanner.js';

async function handleCreateTask(input: CreateTaskInput, ctx: ToolContext) {
  const triggerResult = await scanTaskDescription(input.description);

  return {
    taskId: generateTaskId(),
    description: input.description,
    // ... other fields ...
    suggestedMicroAgents: triggerResult.injectAgents,
    suggestedTakeover: triggerResult.takeoverAgent,
  };
}
```

## 6. Key Code Templates

**Full frontmatter trigger block for all supported modes:**

```yaml
capability:
  triggers:
    # inject mode: adds this agent as a co-participant alongside the primary agent
    - pattern: "\\b(auth|jwt|session|oauth|saml|oidc)\\b"
      mode: "inject"
    # takeover mode: this agent becomes sole handler (highest priority match wins)
    - pattern: "\\b(solidity|\\.sol|smart.contract)\\b"
      mode: "takeover"
```

**TriggerScanResult example output:**

```typescript
{
  taskDescription: "Review the JWT validation in auth.ts for CVE-2024-1234",
  matches: [
    {
      agentSlug: "engineering-security-engineer",
      pattern: "\\b(auth|jwt|session|oauth|saml)\\b",
      mode: "inject",
      matchedText: "JWT"
    },
    {
      agentSlug: "engineering-security-engineer",
      pattern: "CVE-\\d{4}-\\d+",
      mode: "inject",
      matchedText: "CVE-2024-1234"
    }
  ],
  injectAgents: ["engineering-security-engineer"],
  takeoverAgent: undefined
}
```

**Microagent inventory (10 initial specialist agents to add triggers to):**

| Agent slug | Trigger keywords | Mode |
|---|---|---|
| `engineering-security-engineer` | auth, jwt, oauth, CVE-*, sql injection, xss | inject |
| `engineering-git-workflow-master` | git blame, git rebase, merge conflict, gitflow | inject |
| `engineering-devops-automator` | Dockerfile, docker-compose, kubernetes, CI/CD | inject |
| `engineering-solidity-smart-contract-engineer` | .sol, solidity, web3, hardhat | takeover |
| `lsp-index-engineer` | lsp, language server, code completion, symbol | inject |
| `engineering-database-optimizer` | slow query, index, EXPLAIN, query plan | inject |
| `engineering-mobile-app-builder` | react native, flutter, swift, kotlin, xcode | inject |
| `engineering-frontend-developer` | React, Vue, Angular, CSS, Tailwind, DOM | inject |
| `testing-accessibility-auditor` | a11y, accessibility, ARIA, screen reader, WCAG | inject |
| `engineering-sre` | SLO, SLA, incident, oncall, runbook, postmortem | inject |

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/agents/trigger-scanner.test.ts`):
- `scan("Review JWT auth")` returns `injectAgents: ["engineering-security-engineer"]`
- `scan("Fix the Solidity contract")` returns `takeoverAgent: "engineering-solidity-smart-contract-engineer"`
- `scan("Add a button to the homepage")` returns empty `matches` array
- `scan("git rebase main")` returns `injectAgents: ["engineering-git-workflow-master"]`
- Invalid regex in trigger index does not throw; logs warning and skips pattern

**Unit tests** (`v3/@claude-flow/cli/tests/agents/trigger-index.test.ts`):
- `load()` compiles all trigger patterns from registry.json
- `load()` skips deprecated agents
- `load()` skips agents with no `triggers` field
- Invalid regex pattern in registry logs warning and is skipped

**Integration tests** (`v3/mcp/tests/task-tools-triggers.test.ts`):
- `handleCreateTask({ description: "Review JWT auth" })` returns `suggestedMicroAgents: ["engineering-security-engineer"]`
- `handleSpawnAgent` with `config.taskDescription` containing "Dockerfile" attaches `microAgentSuggestions` to result

## 8. Definition of Done

- [ ] `TriggerPattern`, `TriggerMatch`, `TriggerScanResult` types exist in `v3/@claude-flow/shared/src/types/trigger.ts`
- [ ] At least 10 specialist agents have `capability.triggers` in their frontmatter
- [ ] `registry-builder` (Task 30) correctly reads and stores `triggers` from frontmatter into `registry.json`
- [ ] `TriggerScanner.scan()` correctly identifies inject and takeover agents from a task description
- [ ] `handleSpawnAgent` attaches `microAgentSuggestions` to spawn results when trigger matches are found
- [ ] `handleCreateTask` attaches `suggestedMicroAgents` and `suggestedTakeover` to task creation results
- [ ] All unit tests pass
- [ ] TypeScript compiles without errors
- [ ] Scanning a 500-character task description completes in < 5ms (performance requirement — sync regex, no I/O)
