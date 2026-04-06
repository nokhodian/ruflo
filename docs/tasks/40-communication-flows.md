# Task 40: Communication Flows as Explicit Graph Edges
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Medium
**Depends on:** Task 30 (Agent Registry — validates agent slugs in flow declarations)
**Blocks:** (none)

## 1. Current State

In ruflo swarms, any agent can send a message to any other agent at any time. The communication topology is entirely implicit — determined by whatever `SendMessage` calls happen to be made at runtime.

The swarm initialization tool in `v3/mcp/tools/swarm-tools.ts` accepts `topology` (`hierarchical`, `mesh`, `ring`, `star`, `adaptive`) but this only determines how agents are organized; it does not restrict which agents can communicate with which others. There is no `communication_flows` field in any swarm configuration.

No directed communication graph is validated, stored, or enforced during a swarm run. There is no unauthorized-path detection.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/swarm-tools.ts` — `swarm/init` tool handler, swarm config schema
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts` — swarm CLI
- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/swarm/` — swarm-related agent files

## 2. Gap Analysis

**What's missing:**
1. No `communication_flows` field in `swarm/init` input schema — topology is structural, not communicative
2. No `CommunicationGraph` data structure — cannot represent or enforce directed message paths
3. No path enforcement — unauthorized agent-to-agent messages proceed silently
4. No violation recording — unauthorized communication paths leave no audit trail
5. No CLI to visualize the communication graph for a running or completed swarm
6. No schema for declaring flows in swarm configuration files (`.claude/workflows/*.yaml`)

**Concrete failure modes:**
- A `tdd-london-swarm` agent messages a `engineering-backend-architect` directly, bypassing the coordinator; the resulting action is not validated by the consensus layer
- A rogue agent injection (prompt injection attack) causes an agent to send messages to agents it should not know about; no enforcement prevents this
- Post-incident investigation cannot reconstruct whether a communication shortcut caused a swarm state divergence

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/cli/src/swarm/communication-graph.ts` | `CommunicationGraph` class — validates edges, checks authorization |
| `v3/@claude-flow/cli/src/swarm/flow-enforcer.ts` | Intercepts agent-to-agent messages; checks graph; records violations |
| `v3/@claude-flow/cli/src/swarm/flow-visualizer.ts` | Renders communication graph as ASCII or DOT (graphviz) format |
| `v3/@claude-flow/cli/src/commands/flows.ts` | CLI: `flows show`, `flows violations`, `flows validate` |
| `v3/@claude-flow/shared/src/types/communication-flow.ts` | `CommunicationFlow`, `FlowViolation`, `SwarmFlowConfig` TypeScript interfaces |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/mcp/tools/swarm-tools.ts` | Extend `swarm/init` input schema with `communicationFlows` field; store graph in AgentDB on init |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `swarm_communication_flows` and `swarm_flow_violations` table migrations |
| `v3/@claude-flow/cli/src/commands/swarm.ts` | Register `flows` subcommand; expose graph commands |
| `.claude/workflows/*.yaml` (any workflow files) | Document `communication_flows` section in workflow schema |

## 5. Implementation Steps

**Step 1: Define shared types**

Create `v3/@claude-flow/shared/src/types/communication-flow.ts`:

```typescript
/** A directed edge in the communication graph: [from, to] */
export type FlowEdge = [string, string]; // [senderSlug, receiverSlug]

export interface SwarmFlowConfig {
  swarmId: string;
  topology: 'hierarchical' | 'mesh' | 'ring' | 'star' | 'adaptive';
  communicationFlows: FlowEdge[];   // empty = unrestricted (backward compat)
  enforceFlows: boolean;            // false = log only; true = reject unauthorized
}

export interface FlowViolation {
  violationId: string;
  swarmId: string;
  fromAgentSlug: string;
  toAgentSlug: string;
  messagePreview: string;          // first 100 chars of message content
  detectedAt: string;              // ISO 8601
  action: 'blocked' | 'logged';   // blocked if enforceFlows=true
}
```

**Step 2: Add AgentDB tables**

In `v3/@claude-flow/memory/src/agentdb-backend.ts`:

```typescript
await db.exec(`
  CREATE TABLE IF NOT EXISTS swarm_communication_flows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    swarm_id    TEXT    NOT NULL,
    from_slug   TEXT    NOT NULL,
    to_slug     TEXT    NOT NULL,
    enforce     INTEGER NOT NULL DEFAULT 0,  -- 1 = block unauthorized, 0 = log only
    created_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS swarm_flow_violations (
    violation_id    TEXT    PRIMARY KEY,
    swarm_id        TEXT    NOT NULL,
    from_agent_slug TEXT    NOT NULL,
    to_agent_slug   TEXT    NOT NULL,
    message_preview TEXT    NOT NULL DEFAULT '',
    detected_at     TEXT    NOT NULL,
    action          TEXT    NOT NULL DEFAULT 'logged'  -- 'blocked' | 'logged'
  );

  CREATE INDEX IF NOT EXISTS idx_flows_swarm      ON swarm_communication_flows(swarm_id);
  CREATE INDEX IF NOT EXISTS idx_violations_swarm ON swarm_flow_violations(swarm_id);
  CREATE INDEX IF NOT EXISTS idx_violations_from  ON swarm_flow_violations(from_agent_slug);
`);
```

**Step 3: Implement CommunicationGraph**

Create `v3/@claude-flow/cli/src/swarm/communication-graph.ts`:

```typescript
import type { FlowEdge } from '@claude-flow/shared/src/types/communication-flow.js';

export class CommunicationGraph {
  private edges = new Set<string>(); // "from->to"
  private unrestricted: boolean;

  constructor(flows: FlowEdge[]) {
    // Empty flow list = unrestricted (backward compatibility)
    this.unrestricted = flows.length === 0;
    for (const [from, to] of flows) {
      this.edges.add(`${from}->>${to}`);
    }
  }

  isAuthorized(fromSlug: string, toSlug: string): boolean {
    if (this.unrestricted) return true;
    return this.edges.has(`${fromSlug}->>${toSlug}`);
  }

  /** Get all agents that <fromSlug> can send to */
  getTargets(fromSlug: string): string[] {
    return [...this.edges]
      .filter(e => e.startsWith(`${fromSlug}->>`))
      .map(e => e.split('->>')[1]);
  }

  /** Get all agents that can send to <toSlug> */
  getSources(toSlug: string): string[] {
    return [...this.edges]
      .filter(e => e.endsWith(`->>${toSlug}`))
      .map(e => e.split('->>')[0]);
  }

  allEdges(): FlowEdge[] {
    return [...this.edges].map(e => {
      const [from, to] = e.split('->>');
      return [from, to] as FlowEdge;
    });
  }

  /** Check if graph has any cycles (should be acyclic for hierarchical topologies) */
  hasCycles(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string): boolean => {
      visited.add(node);
      inStack.add(node);
      for (const target of this.getTargets(node)) {
        if (!visited.has(target) && dfs(target)) return true;
        if (inStack.has(target)) return true;
      }
      inStack.delete(node);
      return false;
    };

    const allNodes = new Set([...this.edges].flatMap(e => e.split('->>')));
    for (const node of allNodes) {
      if (!visited.has(node) && dfs(node)) return true;
    }
    return false;
  }
}
```

**Step 4: Implement FlowEnforcer**

Create `v3/@claude-flow/cli/src/swarm/flow-enforcer.ts`:

```typescript
import { randomUUID } from 'crypto';
import { CommunicationGraph } from './communication-graph.js';
import type { FlowViolation } from '@claude-flow/shared/src/types/communication-flow.js';

export class FlowEnforcer {
  constructor(
    private db: AgentDBBackend,
    private graph: CommunicationGraph,
    private swarmId: string,
    private enforceMode: boolean,
  ) {}

  /** Returns true if the message should be delivered; false if blocked */
  async checkAndRecord(
    fromSlug: string,
    toSlug: string,
    messageContent: string
  ): Promise<boolean> {
    const authorized = this.graph.isAuthorized(fromSlug, toSlug);
    if (authorized) return true;

    const violation: FlowViolation = {
      violationId: randomUUID(),
      swarmId: this.swarmId,
      fromAgentSlug: fromSlug,
      toAgentSlug: toSlug,
      messagePreview: messageContent.slice(0, 100),
      detectedAt: new Date().toISOString(),
      action: this.enforceMode ? 'blocked' : 'logged',
    };

    await this.db.run(
      `INSERT INTO swarm_flow_violations
       (violation_id, swarm_id, from_agent_slug, to_agent_slug, message_preview, detected_at, action)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [violation.violationId, violation.swarmId, violation.fromAgentSlug,
       violation.toAgentSlug, violation.messagePreview, violation.detectedAt, violation.action]
    );

    if (this.enforceMode) {
      throw new Error(
        `[FlowEnforcer] Unauthorized communication: ${fromSlug} → ${toSlug} is not in declared communication_flows`
      );
    }
    // Log-only mode: warn but allow delivery
    console.warn(`[FlowEnforcer] VIOLATION (logged): ${fromSlug} → ${toSlug}`);
    return true;
  }

  async getViolations(limit = 50): Promise<FlowViolation[]> {
    const rows = await this.db.all(
      'SELECT * FROM swarm_flow_violations WHERE swarm_id = ? ORDER BY detected_at DESC LIMIT ?',
      [this.swarmId, limit]
    );
    return rows.map(r => ({
      violationId: r.violation_id, swarmId: r.swarm_id,
      fromAgentSlug: r.from_agent_slug, toAgentSlug: r.to_agent_slug,
      messagePreview: r.message_preview, detectedAt: r.detected_at, action: r.action,
    }));
  }
}
```

**Step 5: Extend swarm/init schema and handler**

In `v3/mcp/tools/swarm-tools.ts`, extend the init input schema:

```typescript
const swarmInitSchema = z.object({
  topology: z.enum(['hierarchical', 'mesh', 'ring', 'star', 'adaptive']).default('hierarchical'),
  maxAgents: z.number().int().positive().default(8),
  strategy: z.enum(['specialized', 'balanced', 'dynamic']).default('specialized'),
  // New field (Task 40):
  communicationFlows: z.array(
    z.tuple([z.string(), z.string()])
  ).optional().describe(
    'Directed edges [fromSlug, toSlug]. Empty = unrestricted (default). ' +
    'Example: [["hierarchical-coordinator", "coder"], ["coder", "tester"]]'
  ),
  enforceFlows: z.boolean().default(false).describe(
    'If true, unauthorized messages are blocked. If false, they are logged as violations.'
  ),
});
```

In the `handleSwarmInit` function, after creating the swarm record:

```typescript
if (input.communicationFlows && input.communicationFlows.length > 0) {
  // Store edges in AgentDB
  for (const [from, to] of input.communicationFlows) {
    await ctx.db.run(
      'INSERT INTO swarm_communication_flows (swarm_id, from_slug, to_slug, enforce, created_at) VALUES (?, ?, ?, ?, ?)',
      [swarmId, from, to, input.enforceFlows ? 1 : 0, new Date().toISOString()]
    );
  }
  // Validate: all slugs must be in the registry (Task 30)
  const graph = new CommunicationGraph(input.communicationFlows);
  if (graph.hasCycles()) {
    ctx.logger?.warn(`[Swarm] Communication flow graph has cycles — check for infinite delegation loops`);
  }
}
```

**Step 6: Implement flow-visualizer**

Create `v3/@claude-flow/cli/src/swarm/flow-visualizer.ts`:

```typescript
import type { FlowEdge } from '@claude-flow/shared/src/types/communication-flow.js';

export function toAscii(edges: FlowEdge[], title = 'Communication Flow'): string {
  if (edges.length === 0) return `${title}: [unrestricted]`;
  const lines = [`${title}:`, ...edges.map(([from, to]) => `  ${from} --> ${to}`)];
  return lines.join('\n');
}

export function toDOT(edges: FlowEdge[], graphName = 'swarm_flows'): string {
  const edgeLines = edges.map(([from, to]) => `  "${from}" -> "${to}";`);
  return `digraph ${graphName} {\n  rankdir=LR;\n${edgeLines.join('\n')}\n}`;
}
```

**Step 7: CLI commands**

Create `v3/@claude-flow/cli/src/commands/flows.ts`:

```typescript
import { Command } from 'commander';

export function registerFlowsCommand(program: Command): void {
  const cmd = program.command('flows').description('Communication flow graph operations');

  cmd.command('show')
    .argument('<swarmId>', 'Swarm ID')
    .option('--dot', 'Output in DOT format for graphviz')
    .action(async (swarmId, opts) => {
      const edges: FlowEdge[] = await getFlowEdges(swarmId);
      if (opts.dot) {
        console.log(toDOT(edges, `swarm_${swarmId}`));
      } else {
        console.log(toAscii(edges, `Swarm ${swarmId} flows`));
      }
    });

  cmd.command('violations')
    .argument('<swarmId>', 'Swarm ID')
    .option('--json')
    .action(async (swarmId, opts) => {
      const violations = await getViolations(swarmId);
      if (opts.json) { console.log(JSON.stringify(violations, null, 2)); return; }
      if (violations.length === 0) { console.log('No flow violations.'); return; }
      console.table(violations.map(v => ({
        from: v.fromAgentSlug, to: v.toAgentSlug,
        action: v.action, at: v.detectedAt.slice(0, 19)
      })));
    });

  cmd.command('validate')
    .description('Validate that all agent slugs in flow declarations exist in registry')
    .argument('<swarmId>', 'Swarm ID')
    .action(async (swarmId) => {
      const edges = await getFlowEdges(swarmId);
      const { RegistryQuery } = await import('../agents/registry-query.js');
      const q = new RegistryQuery();
      await q.load();
      const allSlugs = new Set(q.allSlugs());
      const unknown = [...new Set(edges.flat())].filter(s => !allSlugs.has(s));
      if (unknown.length === 0) { console.log('All flow agents are registered.'); return; }
      console.error(`Unknown agent slugs in flow: ${unknown.join(', ')}`);
      process.exitCode = 1;
    });
}
```

## 6. Key Code Templates

**Swarm configuration with communication_flows (complete example):**

```typescript
// MCP tool call example
mcp__claude-flow__swarm_init({
  topology: "hierarchical",
  maxAgents: 6,
  strategy: "specialized",
  // Declare allowed communication paths
  communicationFlows: [
    ["hierarchical-coordinator", "engineering-backend-architect"],
    ["hierarchical-coordinator", "tdd-london-swarm"],
    ["hierarchical-coordinator", "engineering-code-reviewer"],
    ["engineering-backend-architect", "engineering-code-reviewer"],
    ["tdd-london-swarm", "engineering-code-reviewer"],
    ["engineering-code-reviewer", "hierarchical-coordinator"]
  ],
  enforceFlows: false  // log violations but don't block (safe default)
})
```

**`.claude/workflows/feature-dev.yaml` example with flows:**

```yaml
name: feature-development
topology: hierarchical
maxAgents: 6
strategy: specialized
communication_flows:
  - [hierarchical-coordinator, engineering-backend-architect]
  - [hierarchical-coordinator, tdd-london-swarm]
  - [engineering-backend-architect, engineering-code-reviewer]
  - [tdd-london-swarm, engineering-code-reviewer]
  - [engineering-code-reviewer, hierarchical-coordinator]
enforce_flows: false
```

**ASCII visualization output:**

```
Swarm swarm-1k9abc flows:
  hierarchical-coordinator --> engineering-backend-architect
  hierarchical-coordinator --> tdd-london-swarm
  hierarchical-coordinator --> engineering-code-reviewer
  engineering-backend-architect --> engineering-code-reviewer
  tdd-london-swarm --> engineering-code-reviewer
  engineering-code-reviewer --> hierarchical-coordinator
```

**CLI commands:**

```bash
# Show communication graph for a swarm
npx claude-flow@v3alpha flows show <swarmId>

# Export as graphviz DOT format
npx claude-flow@v3alpha flows show <swarmId> --dot > swarm-flows.dot

# List flow violations
npx claude-flow@v3alpha flows violations <swarmId>

# Validate all agent slugs exist in registry
npx claude-flow@v3alpha flows validate <swarmId>
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/swarm/communication-graph.test.ts`):
- `isAuthorized(from, to)` returns `true` for declared edge
- `isAuthorized(from, to)` returns `false` for undeclared edge
- Empty `flows` array → `unrestricted = true` → all paths authorized
- `getTargets(slug)` returns correct outbound slugs
- `getSources(slug)` returns correct inbound slugs
- `hasCycles()` returns `true` for graph with cycle `A→B→C→A`
- `hasCycles()` returns `false` for acyclic graph

**Unit tests** (`v3/@claude-flow/cli/tests/swarm/flow-enforcer.test.ts`):
- Authorized message: `checkAndRecord()` returns `true`, no violation written
- Unauthorized message with `enforceMode=false`: returns `true`, violation written with `action='logged'`
- Unauthorized message with `enforceMode=true`: throws error, violation written with `action='blocked'`
- `getViolations()` returns violations for the correct `swarmId`

**Unit tests** (`v3/@claude-flow/cli/tests/swarm/flow-visualizer.test.ts`):
- `toAscii()` contains `from --> to` for each edge
- `toDOT()` produces valid DOT syntax with `->` for each edge

**Integration tests** (`v3/mcp/tests/swarm-tools-flows.test.ts`):
- `swarm/init` with `communicationFlows` writes edges to `swarm_communication_flows` table
- `swarm/init` with empty `communicationFlows` writes no rows (unrestricted)
- `flows validate <swarmId>` exits 0 when all slugs are in registry

## 8. Definition of Done

- [ ] `swarm_communication_flows` and `swarm_flow_violations` tables exist in AgentDB after `init`
- [ ] `swarm/init` tool accepts `communicationFlows` and `enforceFlows` parameters
- [ ] `CommunicationGraph.isAuthorized()` correctly enforces declared edges
- [ ] Flow violations are recorded in `swarm_flow_violations` with correct `action` value
- [ ] `enforceFlows: true` blocks unauthorized messages; `enforceFlows: false` logs them
- [ ] `npx claude-flow@v3alpha flows show <swarmId>` displays communication graph
- [ ] `npx claude-flow@v3alpha flows violations <swarmId>` shows recorded violations
- [ ] `npx claude-flow@v3alpha flows validate <swarmId>` validates all slugs against registry
- [ ] All unit and integration tests pass
- [ ] TypeScript compiles without errors
- [ ] Empty `communicationFlows` array maintains full backward compatibility (unrestricted mode)
