# Task 17: ManagedAgent — Any Agent as a Callable Tool
**Priority:** Phase 2 — Memory & Observability  
**Effort:** Low  
**Depends on:** None (uses existing `handleSpawnAgent` from `agent-tools.ts`)  
**Blocks:** None

---

## 1. Current State

Top-level orchestrator agents delegate to sub-agents via natural language in their system prompt. There is no clean programmatic API for an orchestrator to call a sub-agent and receive its output as a typed value. The pattern requires manual prompt engineering ("delegate this task to the security agent, wait for output, parse the result").

**Relevant files:**
- `v3/mcp/tools/agent-tools.ts` — `handleSpawnAgent()`, `SpawnAgentResult`, `ALLOWED_AGENT_TYPES`
- `v3/mcp/tools/agent-tools.ts` — `agentStatusTool` — exists but only queries status; no await-completion
- `v3/mcp/tools/index.ts` — MCP tool registry
- `v3/@claude-flow/hooks/src/types.ts` — `HookEvent.PostTask`, `HookEvent.AgentTerminate`
- `v3/@claude-flow/hooks/src/registry/index.ts` — `registerHook`

**What is missing:**
- `ManagedAgent` class that wraps `spawnAndAwait(agentSlug, task) → string`
- `ManagedAgent.toMCPTool(agentSlug)` factory that produces a typed `MCPTool` for any agent slug
- `agent/run` MCP tool — a single synchronous call that spawns, awaits, and returns the output
- `AgentRunResult` typed interface

---

## 2. Gap Analysis

| Missing | Effect |
|---|---|
| No `spawnAndAwait` primitive | Orchestrators cannot reliably collect sub-agent outputs |
| No `ManagedAgent.toMCPTool()` | Each new sub-agent delegation requires new tool boilerplate |
| No `agent/run` MCP tool | Claude Code cannot invoke a sub-agent as a function call |
| No timeout on sub-agent runs | Deadlocked sub-agents block the orchestrator indefinitely |

---

## 3. Files to Create

| File | Purpose |
|---|---|
| `v3/@claude-flow/cli/src/agents/managed-agent.ts` | `ManagedAgent` class + `spawnAndAwait` + `toMCPTool()` factory |
| `v3/mcp/tools/managed-agent-tools.ts` | `agent/run` MCP tool + `agent/run-batch` for parallel multi-agent dispatch |

---

## 4. Files to Modify

| File | Change | Why |
|---|---|---|
| `v3/mcp/tools/index.ts` | Add `managedAgentTools` to the all-tools array | MCP registration |
| `v3/mcp/tools/agent-tools.ts` | Export `handleSpawnAgent` so `ManagedAgent` can reuse it | DRY |

---

## 5. Implementation Steps

**Step 1 — Create `v3/@claude-flow/cli/src/agents/managed-agent.ts`**

```typescript
import { z } from 'zod';
import type { MCPTool } from '../../../mcp/tools/../types.js';

export interface AgentRunResult {
  agentSlug: string;
  taskId: string;
  output: string;
  status: 'success' | 'error' | 'timeout';
  durationMs: number;
  tokens?: {
    inputTokens: number;
    outputTokens: number;
  };
  error?: string;
}

export interface ManagedAgentOptions {
  /** Maximum wait time in ms before declaring timeout (default: 120_000) */
  timeoutMs?: number;
  /** Polling interval when waiting for completion (default: 500ms) */
  pollIntervalMs?: number;
}

/**
 * Low-level primitive: spawn an agent, poll until it completes, return the output.
 *
 * In the current ruflo architecture, agent runs are not truly async-awaitable via MCP.
 * This function uses the swarmCoordinator if available, or falls back to a direct
 * hook-based fire-and-collect pattern via PostTask hook.
 */
export async function spawnAndAwait(
  agentSlug: string,
  task: string,
  options: ManagedAgentOptions = {}
): Promise<AgentRunResult> {
  const { timeoutMs = 120_000, pollIntervalMs = 500 } = options;
  const startedAt = Date.now();
  const taskId = `managed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Use a promise that resolves when PostTask hook fires for this taskId
  let resolveOutput: (result: AgentRunResult) => void;
  let rejectTimeout: (err: Error) => void;

  const resultPromise = new Promise<AgentRunResult>((resolve, reject) => {
    resolveOutput = resolve;
    rejectTimeout = reject;
  });

  // Register a one-shot PostTask hook listener
  let unregistered = false;
  const { registerHook, unregisterHook } = await import('@claude-flow/hooks');

  const hookId = `managed-agent-hook-${taskId}`;
  // Note: current HookRegistry does not support per-hook IDs for unregistration.
  // We use a closure flag to skip after first match.
  registerHook({
    event: 'post-task' as any,
    priority: 1, // Background
    handler: async (ctx: any) => {
      if (unregistered) return { success: true };
      if (ctx.data?.taskId !== taskId) return { success: true };
      unregistered = true;

      const output = (ctx.data?.output as string) ?? '';
      const hasError = !!(ctx.data?.error);
      resolveOutput({
        agentSlug,
        taskId,
        output,
        status: hasError ? 'error' : 'success',
        durationMs: Date.now() - startedAt,
        tokens: ctx.data?.tokenUsage as any,
        error: ctx.data?.error as string | undefined,
      });
      return { success: true };
    },
  });

  // Spawn the agent (fire-and-forget; completion detected via hook)
  const { default: agentTools } = await import('../../../mcp/tools/agent-tools.js');
  const spawnTool = agentTools.find(t => t.name === 'agent/spawn');
  if (!spawnTool) throw new Error('agent/spawn tool not found');

  await spawnTool.handler({ agentType: agentSlug, id: taskId, config: { task } }, undefined);

  // Set timeout
  const timer = setTimeout(() => {
    unregistered = true;
    rejectTimeout(new Error(`ManagedAgent timeout: ${agentSlug} did not complete within ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const result = await resultPromise;
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    return {
      agentSlug,
      taskId,
      output: '',
      status: 'timeout',
      durationMs: Date.now() - startedAt,
      error: String(err),
    };
  }
}

/**
 * ManagedAgent — wraps any agent slug as a callable with a typed interface.
 */
export class ManagedAgent {
  constructor(
    private readonly agentSlug: string,
    private readonly options: ManagedAgentOptions = {}
  ) {}

  async run(task: string): Promise<string> {
    const result = await spawnAndAwait(this.agentSlug, task, this.options);
    if (result.status === 'error') {
      throw new Error(`ManagedAgent ${this.agentSlug} failed: ${result.error}`);
    }
    return result.output;
  }

  /**
   * Produce an MCPTool that delegates to this agent.
   * The tool name is `agent_{slug_snake_case}`.
   */
  static toMCPTool(agentSlug: string, options: ManagedAgentOptions = {}): MCPTool {
    const toolName = `agent_${agentSlug.replace(/-/g, '_')}`;
    const managed = new ManagedAgent(agentSlug, options);

    return {
      name: toolName,
      description: `Delegate a task to the ${agentSlug} specialist agent and receive its output`,
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: `Task description to pass to the ${agentSlug} agent`,
          },
          timeoutMs: {
            type: 'number',
            description: 'Override timeout in ms (default: 120000)',
          },
        },
        required: ['task'],
      },
      handler: async (input) => {
        const schema = z.object({
          task:      z.string(),
          timeoutMs: z.number().positive().optional(),
        });
        const { task, timeoutMs } = schema.parse(input);
        const agentOptions = timeoutMs ? { ...options, timeoutMs } : options;
        const result = await spawnAndAwait(agentSlug, task, agentOptions);
        return result;
      },
      category: 'agent',
      tags: ['agent', 'managed', agentSlug],
      version: '1.0.0',
    };
  }
}
```

**Step 2 — Create `v3/mcp/tools/managed-agent-tools.ts`**

```typescript
import { z } from 'zod';
import { MCPTool } from '../types.js';
import { spawnAndAwait, type AgentRunResult } from '../../@claude-flow/cli/src/agents/managed-agent.js';
import { ALLOWED_AGENT_TYPES } from './agent-tools.js';

const agentRunSchema = z.object({
  agentSlug: z.enum(ALLOWED_AGENT_TYPES).or(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).max(64)
  ),
  task: z.string().min(1).describe('Task description to pass to the agent'),
  timeoutMs: z.number().positive().max(600_000).default(120_000)
    .describe('Max wait time in ms (default 120s, max 600s)'),
});

const agentRunBatchSchema = z.object({
  agents: z.array(z.object({
    agentSlug: z.string(),
    task:      z.string(),
  })).min(1).max(10),
  timeoutMs: z.number().positive().max(600_000).default(120_000),
});

export const agentRunTool: MCPTool = {
  name: 'agent/run',
  description: 'Spawn a sub-agent, wait for completion, and return its output. Use this when an orchestrator needs a sub-agent result as a value.',
  inputSchema: {
    type: 'object',
    properties: {
      agentSlug: {
        type: 'string',
        description: 'Agent type slug from ALLOWED_AGENT_TYPES',
      },
      task: {
        type: 'string',
        description: 'Task description to pass to the agent',
      },
      timeoutMs: {
        type: 'number',
        description: 'Max wait time in milliseconds (default: 120000)',
        default: 120000,
      },
    },
    required: ['agentSlug', 'task'],
  },
  handler: async (input): Promise<AgentRunResult> => {
    const { agentSlug, task, timeoutMs } = agentRunSchema.parse(input);
    return spawnAndAwait(agentSlug, task, { timeoutMs });
  },
  category: 'agent',
  tags: ['agent', 'managed', 'spawn', 'await'],
  version: '1.0.0',
};

export const agentRunBatchTool: MCPTool = {
  name: 'agent/run-batch',
  description: 'Spawn multiple sub-agents in parallel and collect all results. Maximum 10 agents per batch.',
  inputSchema: {
    type: 'object',
    properties: {
      agents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agentSlug: { type: 'string' },
            task:      { type: 'string' },
          },
          required: ['agentSlug', 'task'],
        },
        description: 'List of agents and tasks (max 10)',
      },
      timeoutMs: {
        type: 'number',
        description: 'Shared timeout per agent in ms (default: 120000)',
        default: 120000,
      },
    },
    required: ['agents'],
  },
  handler: async (input): Promise<{ results: AgentRunResult[] }> => {
    const { agents, timeoutMs } = agentRunBatchSchema.parse(input);
    const results = await Promise.all(
      agents.map(({ agentSlug, task }) =>
        spawnAndAwait(agentSlug, task, { timeoutMs })
      )
    );
    return { results };
  },
  category: 'agent',
  tags: ['agent', 'managed', 'batch', 'parallel'],
  version: '1.0.0',
};

export const managedAgentTools: MCPTool[] = [agentRunTool, agentRunBatchTool];
export default managedAgentTools;
```

**Step 3 — Export `ALLOWED_AGENT_TYPES` from `agent-tools.ts`**

In `v3/mcp/tools/agent-tools.ts`, change:
```typescript
const ALLOWED_AGENT_TYPES = [...] as const;
```
to:
```typescript
export const ALLOWED_AGENT_TYPES = [...] as const;
```

**Step 4 — Register in `v3/mcp/tools/index.ts`**

```typescript
import { managedAgentTools } from './managed-agent-tools.js';
// Add to allTools array:
export const allTools = [...existingTools, ...managedAgentTools];
```

---

## 6. Key Code Templates

### Orchestrator usage pattern (from inside an agent system prompt)
```
Use the agent/run tool to delegate security review:
{
  "agentSlug": "engineering-security-engineer",
  "task": "Review src/auth/jwt.ts for security vulnerabilities",
  "timeoutMs": 60000
}
```

### Dynamic tool generation for all engineering agents
```typescript
import { ManagedAgent } from '@claude-flow/cli/agents/managed-agent';

const engineeringAgents = [
  'engineering-backend-architect',
  'engineering-security-engineer',
  'engineering-code-reviewer',
];

const dynamicTools = engineeringAgents.map(slug =>
  ManagedAgent.toMCPTool(slug, { timeoutMs: 90_000 })
);
// Register dynamicTools with MCP server
```

### AgentRunResult interface
```typescript
interface AgentRunResult {
  agentSlug: string;
  taskId: string;
  output: string;            // raw string output from agent
  status: 'success' | 'error' | 'timeout';
  durationMs: number;
  tokens?: { inputTokens: number; outputTokens: number };
  error?: string;
}
```

---

## 7. Testing Strategy

**Unit — `v3/@claude-flow/cli/src/agents/managed-agent.test.ts`**
```typescript
describe('ManagedAgent.toMCPTool()', () => {
  it('generates tool with correct name format', () => {
    const tool = ManagedAgent.toMCPTool('engineering-security-engineer');
    expect(tool.name).toBe('agent_engineering_security_engineer');
  });
  it('tool schema requires task field', () => {
    const tool = ManagedAgent.toMCPTool('coder');
    expect(tool.inputSchema.required).toContain('task');
  });
});

describe('spawnAndAwait()', () => {
  it('returns timeout result when agent does not complete within timeoutMs', async () => {
    // Mock hook — never fires PostTask for our taskId
    const result = await spawnAndAwait('coder', 'test task', { timeoutMs: 100 });
    expect(result.status).toBe('timeout');
  });
  it('returns success when PostTask hook fires with matching taskId', async () => {
    // Mock hook to fire immediately with output='done'
    // expect result.status === 'success' and result.output === 'done'
  });
});
```

**Unit — `v3/mcp/tools/managed-agent-tools.test.ts`**
```typescript
describe('agent/run', () => {
  it('rejects invalid agentSlug', async () => {
    await expect(agentRunTool.handler({ agentSlug: '../bad', task: 'x' }))
      .rejects.toThrow();
  });
  it('enforces max timeoutMs of 600000', async () => {
    await expect(agentRunTool.handler({ agentSlug: 'coder', task: 'x', timeoutMs: 700_000 }))
      .rejects.toThrow();
  });
});

describe('agent/run-batch', () => {
  it('rejects > 10 agents', async () => { ... });
  it('returns array with one result per input agent', async () => { ... });
});
```

---

## 8. Definition of Done

- [ ] `v3/@claude-flow/cli/src/agents/managed-agent.ts` compiles
- [ ] `spawnAndAwait()` returns `AgentRunResult` with `status: 'timeout'` when timeout expires
- [ ] `ManagedAgent.toMCPTool('engineering-security-engineer').name === 'agent_engineering_security_engineer'`
- [ ] `agent/run` MCP tool registered and returns `AgentRunResult` shape
- [ ] `agent/run-batch` MCP tool dispatches all agents in parallel (verified via timing test)
- [ ] `ALLOWED_AGENT_TYPES` exported from `agent-tools.ts` (no break in existing tests)
- [ ] Invalid agent slug rejected by Zod validation
- [ ] `timeoutMs > 600000` rejected by Zod validation
- [ ] Unit tests pass for `ManagedAgent.toMCPTool()` and `spawnAndAwait()` timeout case
