# Task 22: Three-Mode Team Routing (route / coordinate / collaborate)
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** Low  
**Depends on:** Task 19 (Task DAG) — `orchestration_mode` field defined there  
**Blocks:** none

## 1. Current State

All agent delegation in ruflo is ad hoc — the orchestrator spawns agents with no declared contract about whether it expects one result, many results, or iterative co-refinement.

| Component | Location | Current Behavior |
|---|---|---|
| Agent spawn | `v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` (line 152) | `{ agentType, id?, config?, priority, metadata? }` — no orchestration mode |
| Swarm topology | `CLAUDE.md` swarm init section | Topology declared (`hierarchical`, `mesh`) but no per-task delegation contract |
| Result collection | No typed collection layer | Caller manually decides whether to wait for one or many results |
| Scratchpad sharing | No implementation | Collaborate mode (iterative co-refinement) has no infrastructure |
| CLAUDE.md routing table | `.agents/skills/agent-coordination/SKILL.md` | Codes 1–13 map task types to agent sets; no mode concept |

**Concrete failure mode 1 (route misused as coordinate):** A coordinator spawns a researcher with `route` semantics but then waits for multiple rounds of output, burning tokens on a message-passing loop that was never designed for it.

**Concrete failure mode 2 (coordinate misused as collaborate):** A code review cycle (reviewer → coder fixes → reviewer re-reviews) is implemented as a one-shot `coordinate` dispatch, missing the iterative refinement loop that gives review cycles their value.

## 2. Gap Analysis

- No `orchestration_mode` on the spawn schema — no way to declare intent.
- No `route` mode executor that dispatches to exactly one agent and returns after the first response.
- No `coordinate` mode executor that breaks a task into subtasks, fans out, collects all, and synthesizes.
- No `collaborate` mode executor with a shared scratchpad, iteration counter, and convergence check.
- Routing table in SKILL.md uses numeric codes with no concept of delegation semantics.
- No telemetry distinguishing which mode was used per task (needed for cost optimization).

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/cli/src/orchestration/routing-modes.ts` | `OrchestrationMode` type + `RouteModeExecutor`, `CoordinateModeExecutor`, `CollaborateModeExecutor` classes |
| `v3/@claude-flow/cli/src/orchestration/mode-dispatcher.ts` | `dispatchWithMode(task, mode)` — selects and calls the correct executor |
| `v3/@claude-flow/shared/src/scratchpad.ts` | `SharedScratchpad` class for collaborate mode: thread-safe append/read, iteration tracking, convergence check |
| `tests/orchestration/routing-modes.test.ts` | Unit tests for all three mode executors using mocked agent dispatch |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/mcp/tools/agent-tools.ts` | Add `orchestration_mode: z.enum(['route', 'coordinate', 'collaborate']).optional()` to `spawnAgentSchema` | Exposes mode selection at the MCP boundary (also added by Task 19) |
| `v3/@claude-flow/cli/src/commands/task.ts` | Pass `orchestration_mode` from task config to `ModeDispatcher.dispatchWithMode` | Wires CLI task command to the new mode system |
| `.agents/skills/agent-coordination/SKILL.md` | Replace the routing codes table (codes 1–13) with a mode + agent recommendation table | Documents the new three-mode semantics for agents reading the skill |

## 5. Implementation Steps

1. **Define the `OrchestrationMode` type** — In `routing-modes.ts`, define the union type, per-mode config interfaces, and the abstract `ModeExecutor` base class with a single `execute(task, config)` abstract method.

2. **Implement `RouteModeExecutor`** — Dispatch task to a single agent (the best match from routing). Wait for one response. Return it immediately. Log mode=`route` to observability. No synthesis step.

3. **Implement `CoordinateModeExecutor`** — Accept a task description. Break it into subtasks (call a `planner` agent to produce the breakdown, or use the DAG if `context_deps` are declared). Fan out all subtasks in parallel. Collect all results. Feed to a synthesis agent (the coordinator). Return synthesis output.

4. **Implement `CollaborateModeExecutor`** — Create a `SharedScratchpad`. Dispatch the first agent with the scratchpad as context. Collect response, append to scratchpad. Dispatch the second agent (e.g., reviewer) with the full scratchpad. Collect response, check convergence (has the reviewer approved? Has `max_iterations` been reached?). Loop until convergence. Return final scratchpad state.

5. **Build `ModeDispatcher`** — In `mode-dispatcher.ts`, implement `dispatchWithMode(task, mode, config)` that instantiates the correct executor and calls `execute`. Default mode is `route` when none specified.

6. **Build `SharedScratchpad`** — In `scratchpad.ts`, a class with: `append(agentId, content)`, `read()` (full history), `iteration` counter, `isConverged(fn)` (caller-supplied predicate).

7. **Update SKILL.md** — Replace the numeric routing codes table with a three-mode guidance table. Keep the agent type lists — they are still valid.

8. **Wire into CLI** — In `commands/task.ts`, extract `orchestration_mode` from task config and pass to `ModeDispatcher`.

9. **Write tests** — Mock the agent dispatch function. Verify: route returns after one call, coordinate fans out and synthesizes, collaborate loops until convergence predicate fires.

## 6. Key Code Templates

```typescript
// v3/@claude-flow/cli/src/orchestration/routing-modes.ts

export type OrchestrationMode = 'route' | 'coordinate' | 'collaborate';

export interface RouteModeConfig {
  agentSlug: string;
  task: string;
}

export interface CoordinateModeConfig {
  plannerSlug?: string;   // default: 'planner'
  synthesizerSlug?: string; // default: 'hierarchical-coordinator'
  task: string;
  maxSubtasks?: number;   // default: 8
}

export interface CollaborateModeConfig {
  agentA: string;           // e.g., 'engineering-senior-developer'
  agentB: string;           // e.g., 'engineering-code-reviewer'
  task: string;
  maxIterations?: number;   // default: 5
  convergencePhrase?: string; // if agentB output contains this, stop; default: 'APPROVED'
}

export abstract class ModeExecutor<TConfig> {
  abstract execute(config: TConfig): Promise<ModeResult>;
}

export interface ModeResult {
  mode: OrchestrationMode;
  output: unknown;
  agentsInvolved: string[];
  iterationCount: number;
  tokenUsage: { input: number; output: number };
  latencyMs: number;
}

// ============================================================================
// Route Mode — single agent dispatch, no synthesis
// ============================================================================

export class RouteModeExecutor extends ModeExecutor<RouteModeConfig> {
  constructor(private dispatcher: AgentDispatcher) { super(); }

  async execute(config: RouteModeConfig): Promise<ModeResult> {
    const start = Date.now();
    const result = await this.dispatcher.dispatch(config.agentSlug, config.task, {});
    return {
      mode: 'route',
      output: result.output,
      agentsInvolved: [config.agentSlug],
      iterationCount: 1,
      tokenUsage: result.tokenUsage ?? { input: 0, output: 0 },
      latencyMs: Date.now() - start,
    };
  }
}

// ============================================================================
// Coordinate Mode — plan, fan-out, synthesize
// ============================================================================

export class CoordinateModeExecutor extends ModeExecutor<CoordinateModeConfig> {
  constructor(private dispatcher: AgentDispatcher) { super(); }

  async execute(config: CoordinateModeConfig): Promise<ModeResult> {
    const start = Date.now();
    const plannerSlug = config.plannerSlug ?? 'planner';
    const synthesizerSlug = config.synthesizerSlug ?? 'hierarchical-coordinator';

    // Step 1: Plan
    const plan = await this.dispatcher.dispatch(plannerSlug, config.task, {
      instruction: 'Break this task into subtasks. Return JSON: { subtasks: [{agentSlug, task}] }'
    });

    const subtasks: Array<{ agentSlug: string; task: string }> = parsePlan(plan.output);
    const capped = subtasks.slice(0, config.maxSubtasks ?? 8);

    // Step 2: Fan out
    const subtaskResults = await Promise.all(
      capped.map(st => this.dispatcher.dispatch(st.agentSlug, st.task, {}))
    );

    // Step 3: Synthesize
    const synthesis = await this.dispatcher.dispatch(synthesizerSlug, config.task, {
      subtaskResults: subtaskResults.map(r => r.output),
    });

    return {
      mode: 'coordinate',
      output: synthesis.output,
      agentsInvolved: [plannerSlug, ...capped.map(st => st.agentSlug), synthesizerSlug],
      iterationCount: 1,
      tokenUsage: { input: 0, output: 0 }, // aggregate from all dispatches
      latencyMs: Date.now() - start,
    };
  }
}

// ============================================================================
// Collaborate Mode — shared scratchpad, iterative refinement
// ============================================================================

export class CollaborateModeExecutor extends ModeExecutor<CollaborateModeConfig> {
  constructor(private dispatcher: AgentDispatcher) { super(); }

  async execute(config: CollaborateModeConfig): Promise<ModeResult> {
    const start = Date.now();
    const scratchpad = new SharedScratchpad();
    const maxIterations = config.maxIterations ?? 5;
    const convergencePhrase = config.convergencePhrase ?? 'APPROVED';
    const agentsInvolved: string[] = [];

    for (let i = 0; i < maxIterations; i++) {
      // Agent A acts (e.g., developer writes/refines code)
      const aResult = await this.dispatcher.dispatch(
        config.agentA, config.task,
        { scratchpad: scratchpad.read(), iteration: i }
      );
      scratchpad.append(config.agentA, String(aResult.output));
      agentsInvolved.push(config.agentA);

      // Agent B reviews
      const bResult = await this.dispatcher.dispatch(
        config.agentB, config.task,
        { scratchpad: scratchpad.read(), iteration: i }
      );
      scratchpad.append(config.agentB, String(bResult.output));
      agentsInvolved.push(config.agentB);

      if (String(bResult.output).includes(convergencePhrase)) break;
    }

    return {
      mode: 'collaborate',
      output: scratchpad.read(),
      agentsInvolved,
      iterationCount: scratchpad.iteration,
      tokenUsage: { input: 0, output: 0 },
      latencyMs: Date.now() - start,
    };
  }
}
```

```typescript
// v3/@claude-flow/shared/src/scratchpad.ts

export interface ScratchpadEntry {
  agentId: string;
  content: string;
  timestamp: Date;
}

export class SharedScratchpad {
  private entries: ScratchpadEntry[] = [];
  public iteration = 0;

  append(agentId: string, content: string): void {
    this.entries.push({ agentId, content, timestamp: new Date() });
    this.iteration++;
  }

  read(): string {
    return this.entries
      .map(e => `[${e.agentId} @ ${e.timestamp.toISOString()}]\n${e.content}`)
      .join('\n\n---\n\n');
  }

  readEntries(): Readonly<ScratchpadEntry[]> {
    return Object.freeze([...this.entries]);
  }

  isConverged(predicate: (entries: ScratchpadEntry[]) => boolean): boolean {
    return predicate(this.entries);
  }

  reset(): void {
    this.entries = [];
    this.iteration = 0;
  }
}
```

```typescript
// v3/@claude-flow/cli/src/orchestration/mode-dispatcher.ts

import {
  OrchestrationMode, RouteModeExecutor, CoordinateModeExecutor, CollaborateModeExecutor,
  ModeResult, RouteModeConfig, CoordinateModeConfig, CollaborateModeConfig
} from './routing-modes.js';

export interface AgentDispatcher {
  dispatch(agentSlug: string, task: string, context: Record<string, unknown>): Promise<{ output: unknown; tokenUsage?: { input: number; output: number } }>;
}

export class ModeDispatcher {
  private routeExec: RouteModeExecutor;
  private coordExec: CoordinateModeExecutor;
  private collabExec: CollaborateModeExecutor;

  constructor(dispatcher: AgentDispatcher) {
    this.routeExec    = new RouteModeExecutor(dispatcher);
    this.coordExec    = new CoordinateModeExecutor(dispatcher);
    this.collabExec   = new CollaborateModeExecutor(dispatcher);
  }

  async dispatchWithMode(
    mode: OrchestrationMode = 'route',
    config: RouteModeConfig | CoordinateModeConfig | CollaborateModeConfig
  ): Promise<ModeResult> {
    switch (mode) {
      case 'route':      return this.routeExec.execute(config as RouteModeConfig);
      case 'coordinate': return this.coordExec.execute(config as CoordinateModeConfig);
      case 'collaborate': return this.collabExec.execute(config as CollaborateModeConfig);
      default: throw new Error(`Unknown orchestration mode: ${mode}`);
    }
  }
}
```

### Updated SKILL.md Routing Section

```markdown
## Orchestration Modes

| Mode | Behavior | When to Use |
|------|----------|-------------|
| `route` | Dispatch to ONE specialist, return first response | Simple single-agent tasks, clearly scoped work |
| `coordinate` | Plan → fan-out subtasks → synthesize results | Multi-step analyses, parallel investigation |
| `collaborate` | Shared scratchpad, iterative co-refinement | Code review cycles, iterative refinement, negotiation |

### Mode Selection Guide

- Bug fix with clear scope → `route` to `coder`
- Feature requiring research + design + implementation → `coordinate` with `planner` + specialists
- Code quality improvement (write → review → revise) → `collaborate` with `coder` + `reviewer`
- Security audit (scan + test + report) → `coordinate` with security specialists
- Architecture decision requiring back-and-forth → `collaborate` with `architect` + `reviewer`
```

## 7. Testing Strategy

```typescript
// tests/orchestration/routing-modes.test.ts

describe('RouteModeExecutor', () => {
  it('calls dispatcher exactly once and returns the result', async () => {
    const calls: string[] = [];
    const mockDispatcher: AgentDispatcher = {
      dispatch: async (slug, task) => {
        calls.push(slug);
        return { output: 'done', tokenUsage: { input: 10, output: 20 } };
      }
    };
    const executor = new RouteModeExecutor(mockDispatcher);
    const result = await executor.execute({ agentSlug: 'coder', task: 'fix bug' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('coder');
    expect(result.mode).toBe('route');
    expect(result.iterationCount).toBe(1);
  });
});

describe('CoordinateModeExecutor', () => {
  it('calls planner once, all subtask agents in parallel, then synthesizer once', async () => {
    const callLog: Array<{ slug: string; order: number }> = [];
    let callOrder = 0;
    const mockDispatcher: AgentDispatcher = {
      dispatch: async (slug) => {
        callLog.push({ slug, order: callOrder++ });
        if (slug === 'planner') {
          return { output: JSON.stringify({ subtasks: [
            { agentSlug: 'coder', task: 'implement' },
            { agentSlug: 'tester', task: 'test' }
          ]}) };
        }
        return { output: 'result' };
      }
    };
    const executor = new CoordinateModeExecutor(mockDispatcher);
    await executor.execute({ task: 'build feature', plannerSlug: 'planner', synthesizerSlug: 'hierarchical-coordinator' });

    const slugs = callLog.map(c => c.slug);
    expect(slugs[0]).toBe('planner');
    expect(slugs.slice(1, 3).sort()).toEqual(['coder', 'tester']);
    expect(slugs[3]).toBe('hierarchical-coordinator');
  });
});

describe('CollaborateModeExecutor', () => {
  it('stops after convergence phrase from agentB', async () => {
    let iteration = 0;
    const mockDispatcher: AgentDispatcher = {
      dispatch: async (slug) => {
        if (slug === 'reviewer') {
          iteration++;
          return { output: iteration >= 2 ? 'APPROVED — looks good' : 'Needs more work' };
        }
        return { output: 'code v' + iteration };
      }
    };
    const executor = new CollaborateModeExecutor(mockDispatcher);
    const result = await executor.execute({
      agentA: 'coder', agentB: 'reviewer', task: 'write function',
      maxIterations: 5, convergencePhrase: 'APPROVED'
    });

    expect(result.iterationCount).toBeLessThanOrEqual(4); // 2 rounds × 2 calls each
  });

  it('stops at max_iterations even when convergence phrase never appears', async () => {
    const mockDispatcher: AgentDispatcher = {
      dispatch: async () => ({ output: 'not approved' })
    };
    const executor = new CollaborateModeExecutor(mockDispatcher);
    const result = await executor.execute({
      agentA: 'coder', agentB: 'reviewer', task: 'fix bug',
      maxIterations: 3, convergencePhrase: 'APPROVED'
    });
    // 3 iterations × 2 agents = 6 calls max
    expect(result.agentsInvolved.length).toBeLessThanOrEqual(6);
  });
});
```

## 8. Definition of Done

- [ ] `orchestration_mode` field added to `spawnAgentSchema` in `agent-tools.ts`
- [ ] `RouteModeExecutor` calls dispatcher exactly once and returns first result
- [ ] `CoordinateModeExecutor` calls planner, fans out subtasks via `Promise.all`, then calls synthesizer
- [ ] `CollaborateModeExecutor` loops until convergence phrase or `max_iterations`
- [ ] `SharedScratchpad.append` is called for both agents each iteration
- [ ] `ModeDispatcher.dispatchWithMode` defaults to `route` when mode is undefined
- [ ] SKILL.md routing codes table replaced with three-mode guidance table
- [ ] All tests pass with zero Claude API calls (mock dispatcher used throughout)
- [ ] `npx claude-flow task run --mode coordinate --task "analyze security"` executes correctly
- [ ] `tsc --noEmit` passes across all new and modified files
