# Task 31: Tool Versioning + Deprecation Warnings
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Low
**Depends on:** Task 30 (Agent Registry — for tool-to-agent impact lookup)
**Blocks:** (none directly, but enables safe tool deprecation across 230+ agents)

## 1. Current State

Ruflo has 40+ MCP tools defined across five files in `v3/mcp/tools/`:

| File | Tools defined |
|------|---------------|
| `v3/mcp/tools/agent-tools.ts` | `agent/spawn`, `agent/list`, `agent/terminate`, `agent/status` |
| `v3/mcp/tools/task-tools.ts` | task CRUD operations |
| `v3/mcp/tools/memory-tools.ts` | memory store/retrieve/search/delete |
| `v3/mcp/tools/swarm-tools.ts` | swarm init/status/shutdown |
| `v3/mcp/tools/hooks-tools.ts` | hooks pre/post-task etc. |
| `v3/mcp/tools/session-tools.ts` | session save/restore/delete |
| `v3/mcp/tools/worker-tools.ts` | background worker dispatch/list |

Each tool is typed via a Zod schema (e.g., `spawnAgentSchema` in `agent-tools.ts` lines 152–158) and exposed as an `MCPTool` object from `v3/mcp/types.ts`. None of these tool objects carry `version`, `deprecated`, or `deprecatedSince` fields. Agents that use deprecated tools receive no warning.

**Current `MCPTool` type** (from `v3/mcp/types.ts`):
```typescript
interface MCPTool {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}
```

No versioning metadata exists on any tool definition today.

## 2. Gap Analysis

**What's missing:**
1. No `version` field on MCP tool schemas — cannot detect breaking API changes
2. No `deprecated` / `deprecatedSince` / `replacedBy` fields — tool removals break agents silently
3. No deprecation warning injection — agents calling deprecated tools receive no hint to migrate
4. No tool changelog — impossible to audit when a tool's input schema changed
5. No tool-to-agent impact analysis — removing a tool requires manually reading all 230+ agent files

**Concrete failure modes:**
- `memory/store` is refactored to require a new required field; all agents calling the old signature fail with cryptic Zod parse errors rather than a clear deprecation message
- A tool is removed from `agent-tools.ts` without notice; agents that reference it in their `tools:` frontmatter array still load without error but fail at runtime
- Task 30 (Registry) needs tool dependency data to answer "which agents will break if I remove this tool?" but no such mapping exists

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/shared/src/types/tool-version.ts` | `VersionedMCPTool`, `ToolDeprecationWarning` TypeScript interfaces |
| `v3/mcp/tool-registry.ts` | Central map of all versioned tools; deprecation checker at request time |
| `v3/@claude-flow/cli/src/commands/tools.ts` | CLI: `tools list`, `tools deprecated`, `tools impact --name <tool>` |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/mcp/types.ts` | Extend `MCPTool` interface with `version`, `deprecated`, `deprecatedSince`, `replacedBy`, `changelog` fields |
| `v3/mcp/tools/agent-tools.ts` | Add version metadata to all 4 tool definitions |
| `v3/mcp/tools/task-tools.ts` | Add version metadata to all task tool definitions |
| `v3/mcp/tools/memory-tools.ts` | Add version metadata to all memory tool definitions |
| `v3/mcp/tools/swarm-tools.ts` | Add version metadata |
| `v3/mcp/tools/hooks-tools.ts` | Add version metadata |
| `v3/mcp/tools/session-tools.ts` | Add version metadata |
| `v3/mcp/tools/worker-tools.ts` | Add version metadata |
| `v3/mcp/index.ts` | Register all tools through `tool-registry.ts`; intercept deprecated tool calls |

## 5. Implementation Steps

**Step 1: Extend MCPTool type**

In `v3/mcp/types.ts`, extend the interface:

```typescript
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;

  // === Versioning (NEW — Task 31) ===
  version: string;             // semver e.g. "1.2.0"
  deprecated?: boolean;        // true = show deprecation warning on each call
  deprecatedSince?: string;    // version when deprecated, e.g. "3.5.0"
  replacedBy?: string;         // name of replacement tool
  changelog?: string;          // human-readable change notes
  removedIn?: string;          // planned removal version, e.g. "4.0.0"
}
```

**Step 2: Create tool-registry.ts**

Create `v3/mcp/tool-registry.ts`:

```typescript
import type { MCPTool, ToolContext } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, MCPTool>();

  register(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: MCPTool[]): void {
    for (const tool of tools) this.register(tool);
  }

  get(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  getAll(): MCPTool[] {
    return [...this.tools.values()];
  }

  getDeprecated(): MCPTool[] {
    return this.getAll().filter(t => t.deprecated);
  }

  /** Wraps handler to inject deprecation warning into tool result */
  wrapDeprecated(tool: MCPTool): MCPTool {
    if (!tool.deprecated) return tool;
    const originalHandler = tool.handler;
    return {
      ...tool,
      handler: async (input: unknown, ctx: ToolContext) => {
        const warning: ToolDeprecationWarning = {
          toolName: tool.name,
          deprecatedSince: tool.deprecatedSince ?? 'unknown',
          replacedBy: tool.replacedBy,
          removedIn: tool.removedIn,
          message: buildDeprecationMessage(tool),
        };
        ctx.logger?.warn(`[DEPRECATED TOOL] ${warning.message}`);
        const result = await originalHandler(input, ctx);
        return { ...((result as object) ?? {}), _deprecationWarning: warning };
      },
    };
  }

  /** Prepare all tools with deprecation wrapping applied */
  buildHandlers(): MCPTool[] {
    return this.getAll().map(t => this.wrapDeprecated(t));
  }
}

function buildDeprecationMessage(tool: MCPTool): string {
  let msg = `Tool '${tool.name}' is deprecated (since v${tool.deprecatedSince ?? '?'}).`;
  if (tool.replacedBy) msg += ` Use '${tool.replacedBy}' instead.`;
  if (tool.removedIn) msg += ` Will be removed in v${tool.removedIn}.`;
  return msg;
}

export interface ToolDeprecationWarning {
  toolName: string;
  deprecatedSince: string;
  replacedBy?: string;
  removedIn?: string;
  message: string;
}

export const globalToolRegistry = new ToolRegistry();
```

**Step 3: Add version metadata to agent-tools.ts**

In `v3/mcp/tools/agent-tools.ts`, update each tool definition to include versioning fields:

```typescript
export const spawnAgentTool: MCPTool = {
  name: 'agent/spawn',
  description: 'Spawn a new agent of a given type',
  inputSchema: spawnAgentSchema,
  handler: handleSpawnAgent,
  // Versioning (Task 31)
  version: '1.2.0',
  deprecated: false,
  changelog: 'v1.2.0: Added priority field; v1.1.0: Added metadata field; v1.0.0: Initial',
};

export const listAgentsTool: MCPTool = {
  name: 'agent/list',
  description: 'List all active agents',
  inputSchema: listAgentsSchema,
  handler: handleListAgents,
  version: '1.0.0',
  deprecated: false,
  changelog: 'v1.0.0: Initial release',
};

export const terminateAgentTool: MCPTool = {
  name: 'agent/terminate',
  description: 'Terminate a running agent',
  inputSchema: terminateAgentSchema,
  handler: handleTerminateAgent,
  version: '1.0.0',
  deprecated: false,
  changelog: 'v1.0.0: Initial release',
};

export const agentStatusTool: MCPTool = {
  name: 'agent/status',
  description: 'Get the current status of an agent',
  inputSchema: agentStatusSchema,
  handler: handleAgentStatus,
  version: '1.0.0',
  deprecated: false,
  changelog: 'v1.0.0: Initial release',
};
```

**Step 4: Register all tools through the registry in index.ts**

In `v3/mcp/index.ts` (or the MCP server startup file), replace direct tool array with registry:

```typescript
import { globalToolRegistry } from './tool-registry.js';
import { spawnAgentTool, listAgentsTool, terminateAgentTool, agentStatusTool } from './tools/agent-tools.js';
// ... other imports

globalToolRegistry.registerAll([
  spawnAgentTool, listAgentsTool, terminateAgentTool, agentStatusTool,
  // ... all task, memory, swarm, hooks, session, worker tools
]);

export const mcpTools = globalToolRegistry.buildHandlers();
```

**Step 5: CLI commands**

Create `v3/@claude-flow/cli/src/commands/tools.ts`:

```typescript
import { Command } from 'commander';
import { globalToolRegistry } from '../../../mcp/tool-registry.js';

export function registerToolsCommand(program: Command): void {
  const cmd = program.command('tools').description('MCP tool management and introspection');

  cmd.command('list')
    .option('--deprecated-only', 'Show only deprecated tools')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const tools = opts.deprecatedOnly
        ? globalToolRegistry.getDeprecated()
        : globalToolRegistry.getAll();
      if (opts.json) { console.log(JSON.stringify(tools.map(t => ({
        name: t.name, version: t.version, deprecated: t.deprecated ?? false,
        replacedBy: t.replacedBy, removedIn: t.removedIn
      })), null, 2)); return; }
      console.table(tools.map(t => ({
        name: t.name, version: t.version,
        deprecated: t.deprecated ? `⚠ since ${t.deprecatedSince}` : '',
        replacedBy: t.replacedBy ?? ''
      })));
    });

  cmd.command('deprecated')
    .description('List all deprecated tools')
    .action(async () => {
      const tools = globalToolRegistry.getDeprecated();
      if (tools.length === 0) { console.log('No deprecated tools.'); return; }
      for (const t of tools) {
        console.log(`⚠  ${t.name} (v${t.version}) — deprecated since v${t.deprecatedSince ?? '?'}`);
        if (t.replacedBy) console.log(`   → Use: ${t.replacedBy}`);
        if (t.removedIn)  console.log(`   ⚠ Planned removal in v${t.removedIn}`);
      }
    });

  cmd.command('impact')
    .description('Show which agents use a given tool')
    .argument('<toolName>', 'MCP tool name')
    .option('--json', 'Output as JSON')
    .action(async (toolName, opts) => {
      // Requires Task 30 registry to be built
      const { RegistryQuery } = await import('../agents/registry-query.js');
      const q = new RegistryQuery();
      await q.load();
      const affected = q.findByTool(toolName);
      if (opts.json) { console.log(JSON.stringify(affected, null, 2)); return; }
      console.log(`Agents using '${toolName}': ${affected.length}`);
      for (const a of affected) {
        console.log(`  ${a.deprecated ? '⚠ (deprecated) ' : ''}${a.slug} v${a.version}`);
      }
    });
}
```

## 6. Key Code Templates

**Versioned MCPTool full interface:**

```typescript
export interface MCPTool {
  // === Existing fields ===
  name: string;
  description: string;
  inputSchema: ZodSchema;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;

  // === Versioning (Task 31) ===
  version: string;          // semver e.g. "1.2.0"
  deprecated?: boolean;     // default: false
  deprecatedSince?: string; // ruflo version when deprecated
  replacedBy?: string;      // name of replacement tool
  removedIn?: string;       // planned removal version
  changelog?: string;       // pipe-separated change log: "v1.2: X | v1.1: Y"
}
```

**Deprecation warning shape injected into tool response:**

```typescript
interface ToolDeprecationWarning {
  toolName: string;
  deprecatedSince: string;
  replacedBy?: string;
  removedIn?: string;
  message: string;  // human-readable full message
}

// Tool response shape when deprecated:
{
  // ... original tool result fields ...
  _deprecationWarning: {
    toolName: "agent/spawn",
    deprecatedSince: "3.5.0",
    replacedBy: "agent/create",
    removedIn: "4.0.0",
    message: "Tool 'agent/spawn' is deprecated (since v3.5.0). Use 'agent/create' instead. Will be removed in v4.0.0."
  }
}
```

**CLI commands:**

```bash
# List all 40+ MCP tools with version info
npx claude-flow@v3alpha tools list

# List only deprecated tools
npx claude-flow@v3alpha tools deprecated

# Show which agents use a specific tool
npx claude-flow@v3alpha tools impact agent/spawn

# Output as JSON for scripting
npx claude-flow@v3alpha tools list --json
npx claude-flow@v3alpha tools impact memory/store --json
```

## 7. Testing Strategy

**Unit tests** (`v3/mcp/tests/tool-registry.test.ts`):
- `register()` stores tool by name
- `getDeprecated()` returns only tools with `deprecated: true`
- `wrapDeprecated()` injects `_deprecationWarning` into result for deprecated tools
- `wrapDeprecated()` calls original handler unchanged for non-deprecated tools
- `buildHandlers()` returns all tools with deprecation wrapping applied

**Integration tests** (`v3/mcp/tests/agent-tools-versioned.test.ts`):
- All tools in `agent-tools.ts` have `version` field matching semver pattern
- No tool in current set has `deprecated: true` (regression check — all tools are current)
- Calling a deprecated tool (test fixture) returns `_deprecationWarning` in response

**CLI tests** (`v3/@claude-flow/cli/tests/commands/tools.test.ts`):
- `tools list` outputs table with all 40+ tool names
- `tools deprecated` outputs empty or known deprecated tools
- `tools impact agent/spawn --json` returns array including agents that declare `agent/spawn` in `tools:` frontmatter

## 8. Definition of Done

- [ ] `MCPTool` interface in `v3/mcp/types.ts` includes `version`, `deprecated`, `deprecatedSince`, `replacedBy`, `removedIn`, `changelog`
- [ ] All tools in `agent-tools.ts`, `task-tools.ts`, `memory-tools.ts`, `swarm-tools.ts`, `hooks-tools.ts`, `session-tools.ts`, `worker-tools.ts` have `version` field set
- [ ] Calling a deprecated tool injects `_deprecationWarning` into the tool response
- [ ] `npx claude-flow@v3alpha tools list` exits 0 and shows all tools
- [ ] `npx claude-flow@v3alpha tools impact <toolName>` shows affected agents (requires Task 30)
- [ ] All unit tests pass: `npm test -- --grep "ToolRegistry"`
- [ ] TypeScript compiles without errors in `v3/mcp/`
