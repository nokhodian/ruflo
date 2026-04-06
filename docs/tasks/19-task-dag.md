# Task 19: Task Context Dependency Graph (DAG)
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** Medium  
**Depends on:** Task 11 (Typed Agent I/O Contracts), Task 12 (Structured Output Auto-Retry)  
**Blocks:** Task 21 (Workflow DSL), Task 20 (Typed Swarm State)

## 1. Current State

Tasks today are submitted to the orchestrator as independent units with no declared inter-task relationships.

| Component | Location | Current Behavior |
|---|---|---|
| Task spawn schema | `v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` (line 152) | `{ agentType, id?, config?, priority, metadata? }` — no dependency field |
| Task execution | `v3/@claude-flow/cli/src/commands/task.ts` | Linear serial dispatch; no DAG concept |
| Task tracking | `v3/mcp/tools/agent-tools.ts` | `listAgentsSchema`, status queries — no cross-task context injection |
| Memory handoff | `v3/@claude-flow/memory/src/` (AgentDB) | Agents share a flat HNSW namespace; upstream outputs not injected as typed context |
| Hooks | `v3/@claude-flow/hooks/src/hooks/pre-task.ts`, `post-task.ts` | Fire per task; do not resolve inter-task dependencies |

**Concrete failure mode:** A 5-agent swarm where agent B needs agent A's findings runs B anyway, re-derives A's work from raw memory retrieval, and may produce inconsistent output. Tasks that could parallelize (B and C, both reading A) are serialized because there is no system to know they are independent of each other.

## 2. Gap Analysis

- No `context_deps` field in task schema — dependency wiring is manual prompt-engineering.
- No DAG builder or topological sort — all tasks are dispatched without knowledge of level membership.
- No upstream output injection — agent B cannot receive agent A's structured output as typed context; it reads raw HNSW chunks instead.
- Tasks that share no dependency are serialized at the CLI orchestrator level, wasting wall-clock time.
- No cycle detection — circular dependencies cause silent hangs.
- No per-task timeout or retry policy at the orchestration level.

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/cli/src/workflow/dag-builder.ts` | Constructs a DAG from a `Task[]` array; validates no cycles; returns topological levels |
| `v3/@claude-flow/cli/src/workflow/dag-executor.ts` | Executes levels in parallel via `Promise.all`; injects upstream results as `context` |
| `v3/@claude-flow/cli/src/workflow/dag-types.ts` | Shared TypeScript interfaces: `DAGTask`, `DAGLevel`, `TaskResult`, `RetryPolicy` |
| `v3/@claude-flow/cli/src/workflow/context-resolver.ts` | Resolves `context_deps` → `TaskResult[]`; validates output schemas match input expectations |
| `tests/workflow/dag-builder.test.ts` | Unit tests for cycle detection, level computation, empty graph |
| `tests/workflow/dag-executor.test.ts` | Integration tests using TestModel (Task 27 dependency) for offline execution |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/mcp/tools/agent-tools.ts` | Add `context_deps?: z.string().array()`, `output_schema?: z.string()`, `timeout_ms?: z.number()`, `retry_policy?: RetryPolicySchema` to `spawnAgentSchema` | Expose dependency declaration at the MCP boundary |
| `v3/@claude-flow/cli/src/commands/task.ts` | Replace linear dispatch loop with `DAGExecutor.execute(tasks)` call | Enables parallel level execution and context injection |
| `v3/@claude-flow/hooks/src/hooks/pre-task.ts` | Accept injected `upstreamContext: TaskResult[]` in hook payload | Allow pre-task hook to validate upstream data is present before starting agent |
| `v3/@claude-flow/hooks/src/hooks/post-task.ts` | Publish `TaskResult` to DAGExecutor result store keyed by `task.id` | Enables downstream tasks to retrieve resolved outputs |
| `v3/@claude-flow/memory/src/agent-db.ts` | Add `storeTaskResult(taskId, result)` and `getTaskResult(taskId)` methods | Persistent task result store for DAG context resolution |

## 5. Implementation Steps

1. **Define shared types** — Create `dag-types.ts` with all interfaces. No logic, just types. Compile-check it.

2. **Build the DAG builder** — In `dag-builder.ts`, implement:
   - `buildDAG(tasks: DAGTask[]): DAG` — constructs adjacency list
   - `detectCycles(dag: DAG): string[][]` — DFS-based cycle finder; returns offending cycle paths
   - `topologicalSort(dag: DAG): DAGLevel[]` — Kahn's algorithm; returns array of levels, each level is an array of tasks that can run in parallel

3. **Extend `spawnAgentSchema`** — In `agent-tools.ts`, add the three new optional fields. Keep all existing fields unchanged. Add `RetryPolicySchema` as a new Zod object schema alongside existing schemas.

4. **Build the context resolver** — In `context-resolver.ts`, implement:
   - `resolveContext(task: DAGTask, results: Map<string, TaskResult>): TaskResult[]`
   - Validates each `context_dep` exists in the result store before returning
   - Throws `ContextResolutionError` with specific missing dep IDs if not

5. **Build the DAG executor** — In `dag-executor.ts`, implement:
   - `execute(tasks: DAGTask[]): Promise<Map<string, TaskResult>>`
   - Build DAG → detect cycles (throw if found) → sort into levels → for each level `Promise.all(level.map(runTask))`
   - `runTask(task, context)` injects resolved upstream results into task metadata before dispatch
   - Per-task timeout via `Promise.race([runTask(), timeout(task.timeout_ms)])`
   - Per-task retry via `RetryPolicy` — exponential backoff

6. **Wire into CLI task command** — In `commands/task.ts`, detect when `--dag` flag is passed or when any task in the batch has `context_deps`. Build `DAGTask[]` from parsed input, call `DAGExecutor.execute()`, print level-by-level progress.

7. **Update hooks** — Modify `pre-task.ts` to receive and log injected context. Modify `post-task.ts` to write result to AgentDB via the new `storeTaskResult` method.

8. **Write tests** — Test cycle detection, parallel level execution, missing dep error, and the happy path of a 3-level DAG.

## 6. Key Code Templates

```typescript
// v3/@claude-flow/cli/src/workflow/dag-types.ts

export interface RetryPolicy {
  maxAttempts: number;       // default: 3
  initialDelayMs: number;    // default: 1000
  backoffMultiplier: number; // default: 2.0
  jitterMs: number;          // default: 500
  retryOn: Array<'RATE_LIMIT' | 'TIMEOUT' | 'VALIDATION' | 'UNKNOWN'>;
}

export interface DAGTask {
  id: string;
  description: string;
  agentSlug: string;
  context_deps?: string[];    // IDs of tasks whose output this task needs
  output_schema?: string;     // path to JSON Schema file
  timeout_ms?: number;        // per-task timeout (default: 300000 = 5 min)
  retry_policy?: RetryPolicy;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  config?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  agentSlug: string;
  output: unknown;            // validated against output_schema if declared
  outputRaw: string;          // raw LLM response text
  tokenUsage?: { input: number; output: number };
  latencyMs: number;
  retryCount: number;
  completedAt: Date;
  status: 'success' | 'error' | 'timeout';
  error?: string;
}

export type DAGLevel = DAGTask[];

export interface DAG {
  tasks: Map<string, DAGTask>;
  edges: Map<string, Set<string>>;   // taskId → Set of tasks that depend on it
  reverseEdges: Map<string, Set<string>>; // taskId → Set of tasks it depends on
}
```

```typescript
// v3/@claude-flow/cli/src/workflow/dag-builder.ts

import { DAGTask, DAGLevel, DAG } from './dag-types.js';

export function buildDAG(tasks: DAGTask[]): DAG {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();

  for (const task of tasks) {
    if (!edges.has(task.id)) edges.set(task.id, new Set());
    if (!reverseEdges.has(task.id)) reverseEdges.set(task.id, new Set());
    for (const dep of task.context_deps ?? []) {
      if (!taskMap.has(dep)) {
        throw new Error(`Task "${task.id}" declares context_dep "${dep}" which does not exist in task list`);
      }
      edges.get(dep)!.add(task.id);
      reverseEdges.get(task.id)!.add(dep);
    }
  }

  return { tasks: taskMap, edges, reverseEdges };
}

export function detectCycles(dag: DAG): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(nodeId: string, path: string[]): void {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    for (const neighbor of dag.edges.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (inStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push(path.slice(cycleStart));
      }
    }

    inStack.delete(nodeId);
  }

  for (const taskId of dag.tasks.keys()) {
    if (!visited.has(taskId)) dfs(taskId, []);
  }
  return cycles;
}

export function topologicalSort(dag: DAG): DAGLevel[] {
  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const taskId of dag.tasks.keys()) inDegree.set(taskId, 0);
  for (const [, deps] of dag.edges) {
    for (const dep of deps) inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
  }

  const levels: DAGLevel[] = [];
  let frontier = [...dag.tasks.values()].filter(t => (inDegree.get(t.id) ?? 0) === 0);

  while (frontier.length > 0) {
    levels.push(frontier);
    const nextFrontier: DAGTask[] = [];
    for (const task of frontier) {
      for (const dependent of dag.edges.get(task.id) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) nextFrontier.push(dag.tasks.get(dependent)!);
      }
    }
    frontier = nextFrontier;
  }

  return levels;
}
```

```typescript
// v3/@claude-flow/cli/src/workflow/dag-executor.ts

import { buildDAG, detectCycles, topologicalSort } from './dag-builder.js';
import { resolveContext } from './context-resolver.js';
import { DAGTask, TaskResult } from './dag-types.js';

export class DAGExecutor {
  private results = new Map<string, TaskResult>();

  async execute(tasks: DAGTask[]): Promise<Map<string, TaskResult>> {
    const dag = buildDAG(tasks);
    const cycles = detectCycles(dag);
    if (cycles.length > 0) {
      throw new Error(`DAG contains cycles: ${cycles.map(c => c.join(' → ')).join('; ')}`);
    }

    const levels = topologicalSort(dag);
    console.log(`[DAG] ${tasks.length} tasks across ${levels.length} levels`);

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      console.log(`[DAG] Level ${i + 1}/${levels.length}: running ${level.length} tasks in parallel`);

      const levelResults = await Promise.all(
        level.map(task => this.runTaskWithRetry(task))
      );

      for (const result of levelResults) {
        this.results.set(result.taskId, result);
      }
    }

    return this.results;
  }

  private async runTaskWithRetry(task: DAGTask): Promise<TaskResult> {
    const context = resolveContext(task, this.results);
    const policy = task.retry_policy ?? {
      maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2.0,
      jitterMs: 500, retryOn: ['RATE_LIMIT', 'TIMEOUT']
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      try {
        return await this.dispatchTask(task, context);
      } catch (err) {
        lastError = err as Error;
        const delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt)
                      + Math.random() * policy.jitterMs;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return {
      taskId: task.id, agentSlug: task.agentSlug, output: null, outputRaw: '',
      latencyMs: 0, retryCount: policy.maxAttempts, completedAt: new Date(),
      status: 'error', error: lastError?.message
    };
  }

  private async dispatchTask(task: DAGTask, context: TaskResult[]): Promise<TaskResult> {
    // Calls the MCP agent spawn tool with context injected into config
    const start = Date.now();
    // Implementation: call spawnAgent MCP tool with task.agentSlug + context payload
    // Placeholder — actual dispatch wired in commands/task.ts
    throw new Error('dispatchTask must be overridden by subclass or injected dispatcher');
  }
}
```

```typescript
// Addition to v3/mcp/tools/agent-tools.ts — extend spawnAgentSchema

const retryPolicySchema = z.object({
  maxAttempts:       z.number().int().min(1).max(10).default(3),
  initialDelayMs:    z.number().int().min(0).default(1000),
  backoffMultiplier: z.number().min(1.0).max(10.0).default(2.0),
  jitterMs:          z.number().int().min(0).default(500),
  retryOn: z.array(z.enum(['RATE_LIMIT', 'TIMEOUT', 'VALIDATION', 'UNKNOWN']))
             .default(['RATE_LIMIT', 'TIMEOUT']),
});

// Extend existing spawnAgentSchema to add:
const spawnAgentSchema = z.object({
  agentType:    agentTypeSchema.describe('Type of agent to spawn'),
  id:           z.string().optional().describe('Optional agent ID (auto-generated if not provided)'),
  config:       z.record(z.unknown()).optional(),
  priority:     z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  metadata:     z.record(z.unknown()).optional(),
  // NEW FIELDS:
  context_deps: z.array(z.string()).optional()
                 .describe('IDs of tasks whose output this task needs as context'),
  output_schema: z.string().optional()
                  .describe('Path to JSON Schema file for validating output'),
  timeout_ms:   z.number().int().positive().optional()
                 .describe('Per-task timeout in milliseconds (default: 300000)'),
  retry_policy: retryPolicySchema.optional(),
  orchestration_mode: z.enum(['route', 'coordinate', 'collaborate']).optional()
                       .describe('Explicit orchestration mode for this spawn (Task 22)'),
});
```

## 7. Testing Strategy

```typescript
// tests/workflow/dag-builder.test.ts

describe('buildDAG', () => {
  it('creates an empty DAG for an empty task list', () => {
    const dag = buildDAG([]);
    expect(dag.tasks.size).toBe(0);
    expect(dag.edges.size).toBe(0);
  });

  it('throws when context_dep references a nonexistent task', () => {
    const tasks = [{ id: 'A', context_deps: ['MISSING'], agentSlug: 'coder', description: '' }];
    expect(() => buildDAG(tasks as DAGTask[])).toThrow(/MISSING/);
  });
});

describe('detectCycles', () => {
  it('returns empty array for a linear chain A → B → C', () => {
    const tasks = [
      { id: 'A', agentSlug: 'coder', description: '', context_deps: [] },
      { id: 'B', agentSlug: 'reviewer', description: '', context_deps: ['A'] },
      { id: 'C', agentSlug: 'tester', description: '', context_deps: ['B'] },
    ] as DAGTask[];
    const dag = buildDAG(tasks);
    expect(detectCycles(dag)).toHaveLength(0);
  });

  it('detects a direct cycle A → B → A', () => {
    const tasks = [
      { id: 'A', agentSlug: 'coder', description: '', context_deps: ['B'] },
      { id: 'B', agentSlug: 'reviewer', description: '', context_deps: ['A'] },
    ] as DAGTask[];
    const dag = buildDAG(tasks);
    expect(detectCycles(dag).length).toBeGreaterThan(0);
  });
});

describe('topologicalSort', () => {
  it('places independent tasks in the same level', () => {
    const tasks = [
      { id: 'A', agentSlug: 'coder', description: '', context_deps: [] },
      { id: 'B', agentSlug: 'coder', description: '', context_deps: [] },
      { id: 'C', agentSlug: 'reviewer', description: '', context_deps: ['A', 'B'] },
    ] as DAGTask[];
    const dag = buildDAG(tasks);
    const levels = topologicalSort(dag);
    expect(levels).toHaveLength(2);
    expect(levels[0].map(t => t.id).sort()).toEqual(['A', 'B']);
    expect(levels[1].map(t => t.id)).toEqual(['C']);
  });
});

describe('DAGExecutor integration', () => {
  it('executes a 2-level DAG and injects upstream context into level-2 tasks', async () => {
    // Uses a mock dispatcher — does not call real Claude API
    // Asserts context passed to task C contains results from A and B
  });

  it('returns error result (not throws) when a task exhausts retries', async () => {
    // Mock dispatcher always throws RATE_LIMIT
    // Asserts result has status: 'error' and retryCount === maxAttempts
  });
});
```

## 8. Definition of Done

- [ ] `DAGTask` interface includes `context_deps`, `output_schema`, `timeout_ms`, `retry_policy`
- [ ] `spawnAgentSchema` in `agent-tools.ts` includes all new optional fields and passes `tsc --noEmit`
- [ ] `buildDAG` throws a descriptive error for references to nonexistent task IDs
- [ ] `detectCycles` correctly identifies direct and transitive cycles
- [ ] `topologicalSort` returns independent tasks in the same level (verified by test)
- [ ] `DAGExecutor.execute` runs tasks in topological level order with `Promise.all` per level
- [ ] Upstream task outputs are injected as `context` in the downstream task's config before dispatch
- [ ] Per-task timeout enforced via `Promise.race`
- [ ] Retry policy with exponential backoff + jitter operational
- [ ] Failed tasks produce a `TaskResult` with `status: 'error'`; executor does not throw
- [ ] All unit tests in `tests/workflow/dag-builder.test.ts` pass with zero Claude API calls
- [ ] `npx claude-flow task run --dag tasks.json` executes a multi-task DAG from a JSON file
