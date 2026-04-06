# Task 48: SubGraph Composition (Modular Topology Design)

**Priority:** Phase 4 — Advanced Features
**Effort:** Medium
**Depends on:** (none — this task establishes the foundational topology abstraction; other tasks build on it)
**Blocks:** Task 41 (Isolated Threads — thread keys require pair topology), Task 44 (Nested Swarms — a nested swarm IS a SubGraph executed as a child)

---

## 1. Current State

Ruflo swarm topology is monolithic. All agents are defined in a flat `.claude/agents/` directory structure organized by category subdirectory, but these subdirectories have no programmatic significance as composable topology units. There is no `SubGraph` abstraction, no independent compilation, testing, or versioning of topology segments.

Relevant files:

- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/` — agent definitions organized in subdirectories: `engineering/`, `security/`, `marketing/`, `testing/`, `specialized/`, etc. These directories are currently just organizational folders; they are not compiled into topology units.
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/swarm-tools.ts` — swarm tools (`swarm_init`, `swarm_status`, `swarm_shutdown`). No `compile_subgraph`, `add_subgraph`, or `connect_subgraphs` tool.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/swarm/` — swarm state directory. No SubGraph registry or compiler.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts` — CLI swarm command; no `swarm subgraph` subcommand.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB; no SubGraph state namespace.

**Current `.claude/agents/` directory mapping to SubGraph potential:**

| Directory | Agent Count | Natural SubGraph |
|---|---|---|
| `.claude/agents/engineering/` | ~30 agents | `EngineeringSubGraph` |
| `.claude/agents/security/` | ~8 agents | `SecuritySubGraph` |
| `.claude/agents/testing/` | ~8 agents | `TestingSubGraph` |
| `.claude/agents/marketing/` | ~25 agents | `MarketingSubGraph` |
| `.claude/agents/specialized/` | ~20 agents | `SpecializedSubGraph` |

---

## 2. Gap Analysis

**What is missing:**

1. No `SubGraph` interface — no data structure to represent a compilable, testable topology unit.
2. No `SubGraphCompiler` — no process to scan a `.claude/agents/<category>/` directory and produce a `CompiledSubGraph`.
3. No `SubGraphRegistry` — no registry of available sub-graphs indexed by name/capability.
4. No `SubGraphComposer` — no mechanism for a top-level orchestrator to assemble sub-graphs into a composite topology.
5. No `inputKeys`/`outputKeys` contract — sub-graphs cannot declare what state they read from and write to the parent.
6. No `internalEdges` — message routing within a sub-graph is not declared separately from cross-graph routing.
7. No `swarm subgraph` CLI subcommand — operators cannot inspect, test, or compose sub-graphs manually.
8. No per-sub-graph version tracking — cannot independently version `SecuritySubGraph v1.2` separately from `TestingSubGraph v3.0`.

**Concrete failure modes:**

- Modifying the `security` agent prompt requires understanding the entire swarm topology instead of just the isolated security sub-graph.
- Testing the `EngineeringSubGraph` requires spinning up the full swarm including unrelated marketing and sales agents.
- Adding a new agent to `.claude/agents/engineering/` implicitly changes the full swarm topology with no visibility into what changed.
- Two parallel sub-swarms writing to the same parent state keys without declared `outputKeys` create silent state corruption.
- No way to pin `SecuritySubGraph` to a specific version while upgrading `EngineeringSubGraph`.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/subgraph/subgraph.ts` | `SubGraph` interface + `CompiledSubGraph` type |
| `v3/@claude-flow/hooks/src/subgraph/subgraph-compiler.ts` | `SubGraphCompiler` — scans `.claude/agents/<dir>` and produces `CompiledSubGraph` |
| `v3/@claude-flow/hooks/src/subgraph/subgraph-registry.ts` | `SubGraphRegistry` — stores, retrieves, and versions sub-graphs |
| `v3/@claude-flow/hooks/src/subgraph/subgraph-composer.ts` | `SubGraphComposer` — assembles multiple sub-graphs into a composite topology |
| `v3/@claude-flow/hooks/src/subgraph/edge.ts` | `Edge` type — directed connections between agent nodes |
| `v3/@claude-flow/hooks/src/subgraph/agent-node.ts` | `AgentNode` type — node in a sub-graph, references agent slug |
| `v3/@claude-flow/hooks/src/subgraph/types.ts` | Shared types: `SubGraphManifest`, `ComposedTopology`, `StateKey` |
| `v3/@claude-flow/hooks/src/subgraph/index.ts` | Barrel export |
| `v3/@claude-flow/hooks/src/__tests__/subgraph.test.ts` | Unit tests |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `v3/mcp/tools/swarm-tools.ts` | Add `compile_subgraph` tool (scans a category dir, returns `CompiledSubGraph`). Add `compose_topology` tool (takes array of sub-graph IDs, returns composed topology). Add `list_subgraphs` tool. |
| `v3/@claude-flow/cli/src/commands/swarm.ts` | Add `swarm subgraph list`, `swarm subgraph compile --dir <path>`, `swarm subgraph inspect --id <id>`, `swarm subgraph compose --ids <a,b,c>`. |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `storeSubGraph(id: string, compiled: CompiledSubGraph)` and `getSubGraph(id: string)` using `subgraphs:*` namespace. |
| `.claude/agents/engineering/` | Add `_subgraph.manifest.yaml` file to declare the engineering sub-graph's `inputKeys`, `outputKeys`, and version. |
| `.claude/agents/security/` | Add `_subgraph.manifest.yaml` file similarly. |
| `.claude/agents/testing/` | Add `_subgraph.manifest.yaml` file similarly. |

---

## 5. Implementation Steps

**Step 1 — Define SubGraph interface and types**

Create `v3/@claude-flow/hooks/src/subgraph/types.ts`. See Key Code Templates — this is the authoritative `SubGraph` interface.

**Step 2 — Define `AgentNode` and `Edge`**

Create `v3/@claude-flow/hooks/src/subgraph/agent-node.ts` and `v3/@claude-flow/hooks/src/subgraph/edge.ts`. See Key Code Templates.

**Step 3 — Implement `SubGraphCompiler`**

Create `v3/@claude-flow/hooks/src/subgraph/subgraph-compiler.ts`. See Key Code Templates — this is how `.claude/agents/` subdirectories map to SubGraph objects.

**Step 4 — Implement `SubGraphRegistry`**

Create `v3/@claude-flow/hooks/src/subgraph/subgraph-registry.ts`. See Key Code Templates.

**Step 5 — Implement `SubGraphComposer`**

Create `v3/@claude-flow/hooks/src/subgraph/subgraph-composer.ts`. See Key Code Templates.

**Step 6 — Create manifest files for major categories**

Create `_subgraph.manifest.yaml` in the following directories. Example for engineering:

```yaml
# .claude/agents/engineering/_subgraph.manifest.yaml
id: engineering
version: "1.0.0"
name: Engineering SubGraph
description: Full-stack engineering specialists
inputKeys:
  - task_description
  - code_context
  - tech_stack
outputKeys:
  - implementation_result
  - code_diff
  - test_coverage
defaultCoordinator: engineering-software-architect
maxConcurrentAgents: 4
```

Create equivalent manifests for:
- `.claude/agents/security/_subgraph.manifest.yaml`
- `.claude/agents/testing/_subgraph.manifest.yaml`
- `.claude/agents/specialized/_subgraph.manifest.yaml`

**Step 7 — Add MCP tools to `swarm-tools.ts`**

Edit `v3/mcp/tools/swarm-tools.ts`. Add three tool definitions:

```typescript
// compile_subgraph schema
const compileSubgraphSchema = z.object({
  directory: z.string().describe('Path to the .claude/agents/<category>/ directory to compile'),
  manifest_path: z.string().optional().describe('Override path to _subgraph.manifest.yaml'),
});

// compose_topology schema
const composeTopologySchema = z.object({
  subgraph_ids: z.array(z.string()).min(2).describe('IDs of sub-graphs to compose'),
  topology: z.enum(['sequential', 'parallel', 'conditional']).default('parallel'),
  state_merge_strategy: z.enum(['last-write-wins', 'merge', 'explicit']).default('merge'),
});

// list_subgraphs schema
const listSubgraphsSchema = z.object({
  category_filter: z.string().optional(),
  include_compiled: z.boolean().default(false),
});
```

**Step 8 — CLI subcommands**

Edit `v3/@claude-flow/cli/src/commands/swarm.ts`. Add:

```typescript
.command('subgraph list')
.description('List all registered SubGraphs')
.option('--category <category>', 'Filter by category')

.command('subgraph compile')
.description('Compile a .claude/agents/ directory into a SubGraph')
.requiredOption('--dir <path>', 'Path to the agent category directory')
.option('--save', 'Save compiled SubGraph to AgentDB registry')

.command('subgraph inspect')
.description('Show the compiled details of a SubGraph')
.requiredOption('--id <id>', 'SubGraph ID')

.command('subgraph compose')
.description('Compose multiple SubGraphs into a topology')
.requiredOption('--ids <a,b,c>', 'Comma-separated SubGraph IDs')
.option('--topology <type>', 'sequential | parallel | conditional', 'parallel')
```

**Step 9 — AgentDB storage**

Edit `v3/@claude-flow/memory/src/agentdb-backend.ts`. Add:

```typescript
async storeSubGraph(id: string, compiled: CompiledSubGraph): Promise<void> {
  await this.store(`subgraphs:${id}`, compiled);
}

async getSubGraph(id: string): Promise<CompiledSubGraph | null> {
  return this.retrieve(`subgraphs:${id}`) as CompiledSubGraph | null;
}

async listSubGraphs(): Promise<CompiledSubGraph[]> {
  const keys = await this.listKeys('subgraphs:');
  const graphs = await Promise.all(keys.map(k => this.retrieve(k)));
  return graphs.filter(Boolean) as CompiledSubGraph[];
}
```

**Step 10 — Write tests**

Create `v3/@claude-flow/hooks/src/__tests__/subgraph.test.ts`. See Testing Strategy.

---

## 6. Key Code Templates

### `types.ts` — The Authoritative `SubGraph` Interface

```typescript
export type StateKey = string;  // e.g., "task_description", "code_diff"

export interface AgentNode {
  id: string;           // unique within the SubGraph, e.g., "security-architect-1"
  agentSlug: string;    // references ALLOWED_AGENT_TYPES or EphemeralRegistry
  role: 'coordinator' | 'specialist' | 'reviewer' | 'synthesizer';
  priority: 'low' | 'normal' | 'high';
  maxTokenBudget?: number;
}

export interface Edge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: 'sequential' | 'parallel' | 'conditional' | 'feedback';
  condition?: string;   // JS expression evaluated against swarm state for 'conditional' edges
  stateKeys?: StateKey[]; // which state keys are passed along this edge
}

export interface SubGraph {
  id: string;
  version: string;
  name: string;
  description: string;
  category: string;     // maps to .claude/agents/<category>/ directory name
  agents: AgentNode[];
  internalEdges: Edge[];
  inputKeys: StateKey[];    // state keys this SubGraph reads from parent
  outputKeys: StateKey[];   // state keys this SubGraph writes to parent
  defaultCoordinator: string; // agentSlug of the coordinator node
  maxConcurrentAgents: number;
  compile(): CompiledSubGraph;
}

export interface CompiledSubGraph {
  subGraphId: string;
  version: string;
  category: string;
  agentCount: number;
  edgeCount: number;
  inputKeys: StateKey[];
  outputKeys: StateKey[];
  compiledAt: Date;
  checksum: string;   // SHA-256 of the canonical JSON representation
  raw: SubGraph;      // the original SubGraph definition
}

export interface SubGraphManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  inputKeys: StateKey[];
  outputKeys: StateKey[];
  defaultCoordinator: string;
  maxConcurrentAgents: number;
}

export interface ComposedTopology {
  topologyId: string;
  subGraphs: CompiledSubGraph[];
  connectionEdges: Edge[];        // edges that connect sub-graphs to each other
  topology: 'sequential' | 'parallel' | 'conditional';
  stateMergeStrategy: 'last-write-wins' | 'merge' | 'explicit';
  composedAt: Date;
}
```

### `subgraph-compiler.ts` — How `.claude/agents/` Maps to SubGraph Objects

```typescript
import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { parse as parseYAML } from 'yaml';
import type { SubGraph, CompiledSubGraph, AgentNode, SubGraphManifest } from './types.js';
import type { Edge } from './edge.js';

export class SubGraphCompiler {
  /**
   * Scans a .claude/agents/<category>/ directory and produces a CompiledSubGraph.
   *
   * Directory mapping rules:
   *   - Each .md file in the directory becomes an AgentNode
   *   - _subgraph.manifest.yaml provides inputKeys, outputKeys, version, etc.
   *   - If no manifest exists, sensible defaults are applied
   *   - Internal edges are auto-generated: coordinator → all specialists (parallel)
   *   - Default coordinator: the agent whose filename contains 'architect' or 'coordinator'
   */
  static async compile(
    directoryPath: string,
    manifestOverridePath?: string
  ): Promise<CompiledSubGraph> {
    const category = basename(directoryPath);

    // 1. Read manifest
    const manifestPath = manifestOverridePath ?? join(directoryPath, '_subgraph.manifest.yaml');
    let manifest: SubGraphManifest;
    try {
      const manifestContent = await readFile(manifestPath, 'utf8');
      manifest = parseYAML(manifestContent) as SubGraphManifest;
    } catch {
      // No manifest — use defaults
      manifest = SubGraphCompiler.defaultManifest(category);
    }

    // 2. Scan .md files for agent nodes
    const files = await readdir(directoryPath);
    const agentFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('_'));
    const agents: AgentNode[] = agentFiles.map(file => {
      const slug = file.replace('.md', '');
      const isCoordinator = slug.includes('architect') || slug.includes('coordinator') || slug === manifest.defaultCoordinator;
      return {
        id: `${category}-${slug}`,
        agentSlug: slug,
        role: isCoordinator ? 'coordinator' : 'specialist',
        priority: isCoordinator ? 'high' : 'normal',
      };
    });

    // 3. Auto-generate internal edges (star topology from coordinator)
    const coordinator = agents.find(a => a.role === 'coordinator') ?? agents[0];
    const internalEdges: Edge[] = agents
      .filter(a => a.id !== coordinator?.id)
      .map((specialist, i) => ({
        id: `${category}-edge-${i}`,
        sourceNodeId: coordinator!.id,
        targetNodeId: specialist.id,
        type: 'parallel' as const,
        stateKeys: manifest.inputKeys,
      }));

    const subGraph: SubGraph = {
      id: manifest.id ?? category,
      version: manifest.version ?? '1.0.0',
      name: manifest.name ?? `${category} SubGraph`,
      description: manifest.description ?? `Auto-compiled from .claude/agents/${category}/`,
      category,
      agents,
      internalEdges,
      inputKeys: manifest.inputKeys ?? ['task_description'],
      outputKeys: manifest.outputKeys ?? ['result'],
      defaultCoordinator: coordinator?.agentSlug ?? agents[0]?.agentSlug ?? 'coder',
      maxConcurrentAgents: manifest.maxConcurrentAgents ?? 4,
      compile: () => compiled,
    };

    const canonicalJSON = JSON.stringify(subGraph, null, 0);
    const checksum = createHash('sha256').update(canonicalJSON).digest('hex');

    const compiled: CompiledSubGraph = {
      subGraphId: subGraph.id,
      version: subGraph.version,
      category,
      agentCount: agents.length,
      edgeCount: internalEdges.length,
      inputKeys: subGraph.inputKeys,
      outputKeys: subGraph.outputKeys,
      compiledAt: new Date(),
      checksum,
      raw: subGraph,
    };

    return compiled;
  }

  private static defaultManifest(category: string): SubGraphManifest {
    return {
      id: category,
      version: '1.0.0',
      name: `${category.charAt(0).toUpperCase() + category.slice(1)} SubGraph`,
      description: `Auto-generated SubGraph for category: ${category}`,
      inputKeys: ['task_description', 'context'],
      outputKeys: ['result', 'artifacts'],
      defaultCoordinator: `${category}-coordinator`,
      maxConcurrentAgents: 4,
    };
  }
}
```

### `subgraph-composer.ts`

```typescript
import { randomBytes } from 'crypto';
import type { CompiledSubGraph, ComposedTopology, Edge } from './types.js';

export class SubGraphComposer {
  /**
   * Validates that sub-graph outputKeys from upstream graphs
   * satisfy inputKeys required by downstream graphs.
   * Throws if there are unsatisfied key dependencies.
   */
  static validateKeyContracts(subGraphs: CompiledSubGraph[]): void {
    const allOutputKeys = new Set<string>();
    const errors: string[] = [];

    for (let i = 0; i < subGraphs.length; i++) {
      const sg = subGraphs[i];
      if (i > 0) {
        // Check inputKeys of current sub-graph are satisfied by prior outputs
        for (const key of sg.inputKeys) {
          if (!allOutputKeys.has(key)) {
            errors.push(
              `SubGraph '${sg.subGraphId}' requires inputKey '${key}' but no prior SubGraph declares it as outputKey.`
            );
          }
        }
      }
      sg.outputKeys.forEach(k => allOutputKeys.add(k));
    }

    if (errors.length > 0) {
      throw new Error(`SubGraph composition key contract violations:\n${errors.join('\n')}`);
    }
  }

  /**
   * Composes multiple compiled sub-graphs into a topology.
   * For 'sequential' topology: validates key contracts.
   * For 'parallel' topology: all sub-graphs receive same input.
   * For 'conditional' topology: caller must declare conditional edges.
   */
  static compose(
    subGraphs: CompiledSubGraph[],
    topology: 'sequential' | 'parallel' | 'conditional' = 'parallel',
    stateMergeStrategy: 'last-write-wins' | 'merge' | 'explicit' = 'merge'
  ): ComposedTopology {
    if (subGraphs.length < 2) {
      throw new Error('Composition requires at least 2 sub-graphs.');
    }

    if (topology === 'sequential') {
      SubGraphComposer.validateKeyContracts(subGraphs);
    }

    // Generate connection edges between sub-graphs
    const connectionEdges: Edge[] = [];
    if (topology === 'sequential') {
      for (let i = 0; i < subGraphs.length - 1; i++) {
        connectionEdges.push({
          id: `conn-${i}-${i + 1}`,
          sourceNodeId: subGraphs[i].subGraphId,
          targetNodeId: subGraphs[i + 1].subGraphId,
          type: 'sequential',
          stateKeys: subGraphs[i].outputKeys,
        });
      }
    }

    return {
      topologyId: `topo-${randomBytes(6).toString('hex')}`,
      subGraphs,
      connectionEdges,
      topology,
      stateMergeStrategy,
      composedAt: new Date(),
    };
  }
}
```

### `subgraph-registry.ts`

```typescript
import type { CompiledSubGraph } from './types.js';

export class SubGraphRegistry {
  private static instance: SubGraphRegistry;
  private registry: Map<string, CompiledSubGraph[]> = new Map(); // id → version history

  static getInstance(): SubGraphRegistry {
    if (!SubGraphRegistry.instance) {
      SubGraphRegistry.instance = new SubGraphRegistry();
    }
    return SubGraphRegistry.instance;
  }

  register(compiled: CompiledSubGraph): void {
    const versions = this.registry.get(compiled.subGraphId) ?? [];
    versions.push(compiled);
    this.registry.set(compiled.subGraphId, versions);
  }

  getLatest(id: string): CompiledSubGraph | undefined {
    const versions = this.registry.get(id);
    if (!versions || versions.length === 0) return undefined;
    return versions[versions.length - 1];
  }

  getVersion(id: string, version: string): CompiledSubGraph | undefined {
    return this.registry.get(id)?.find(v => v.version === version);
  }

  listAll(): CompiledSubGraph[] {
    return Array.from(this.registry.values()).map(versions => versions[versions.length - 1]);
  }

  listVersions(id: string): string[] {
    return (this.registry.get(id) ?? []).map(v => v.version);
  }

  /**
   * Detects if a newly compiled sub-graph has changed from the last registered version.
   * Returns true if checksums differ.
   */
  hasChanged(compiled: CompiledSubGraph): boolean {
    const latest = this.getLatest(compiled.subGraphId);
    if (!latest) return true;
    return latest.checksum !== compiled.checksum;
  }
}
```

---

## 7. Testing Strategy

File: `v3/@claude-flow/hooks/src/__tests__/subgraph.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SubGraphComposer } from '../subgraph/subgraph-composer.js';
import { SubGraphRegistry } from '../subgraph/subgraph-registry.js';
import type { CompiledSubGraph } from '../subgraph/types.js';

const makeSubGraph = (id: string, inputKeys: string[], outputKeys: string[]): CompiledSubGraph => ({
  subGraphId: id,
  version: '1.0.0',
  category: id,
  agentCount: 2,
  edgeCount: 1,
  inputKeys,
  outputKeys,
  compiledAt: new Date(),
  checksum: `checksum-${id}`,
  raw: {} as any,
});

describe('SubGraphComposer.validateKeyContracts', () => {
  it('passes when outputKeys satisfy downstream inputKeys', () => {
    const sg1 = makeSubGraph('sg1', ['task'], ['code_diff', 'tests']);
    const sg2 = makeSubGraph('sg2', ['code_diff'], ['review_result']);
    expect(() => SubGraphComposer.validateKeyContracts([sg1, sg2])).not.toThrow();
  });

  it('throws when inputKey is not satisfied by prior outputKeys', () => {
    const sg1 = makeSubGraph('sg1', ['task'], ['code_diff']);
    const sg2 = makeSubGraph('sg2', ['security_report'], ['findings']); // 'security_report' not in sg1 outputs
    expect(() => SubGraphComposer.validateKeyContracts([sg1, sg2]))
      .toThrow("requires inputKey 'security_report'");
  });

  it('first sub-graph inputKeys are not validated (they come from parent)', () => {
    const sg1 = makeSubGraph('sg1', ['anything'], ['result']);
    const sg2 = makeSubGraph('sg2', ['result'], ['final']);
    expect(() => SubGraphComposer.validateKeyContracts([sg1, sg2])).not.toThrow();
  });
});

describe('SubGraphComposer.compose', () => {
  it('creates a topology with connection edges for sequential mode', () => {
    const sg1 = makeSubGraph('engineering', ['task'], ['code_diff']);
    const sg2 = makeSubGraph('testing', ['code_diff'], ['test_results']);
    const topology = SubGraphComposer.compose([sg1, sg2], 'sequential');
    expect(topology.connectionEdges).toHaveLength(1);
    expect(topology.connectionEdges[0].sourceNodeId).toBe('engineering');
    expect(topology.connectionEdges[0].targetNodeId).toBe('testing');
    expect(topology.connectionEdges[0].type).toBe('sequential');
  });

  it('creates no connection edges for parallel mode', () => {
    const sg1 = makeSubGraph('engineering', ['task'], ['code_diff']);
    const sg2 = makeSubGraph('security', ['task'], ['findings']);
    const topology = SubGraphComposer.compose([sg1, sg2], 'parallel');
    expect(topology.connectionEdges).toHaveLength(0);
  });

  it('throws when fewer than 2 sub-graphs provided', () => {
    const sg1 = makeSubGraph('engineering', ['task'], ['code_diff']);
    expect(() => SubGraphComposer.compose([sg1])).toThrow('at least 2');
  });

  it('throws for sequential mode when key contracts are violated', () => {
    const sg1 = makeSubGraph('sg1', ['task'], ['code_diff']);
    const sg2 = makeSubGraph('sg2', ['security_report'], ['findings']); // unsatisfied
    expect(() => SubGraphComposer.compose([sg1, sg2], 'sequential'))
      .toThrow("requires inputKey 'security_report'");
  });
});

describe('SubGraphRegistry', () => {
  it('registers and retrieves latest compiled sub-graph', () => {
    const registry = new SubGraphRegistry();
    const sg = makeSubGraph('engineering', ['task'], ['result']);
    (registry as any).registry = new Map(); // reset
    registry.register(sg);
    expect(registry.getLatest('engineering')).toEqual(sg);
  });

  it('tracks multiple versions and returns latest', () => {
    const registry = new SubGraphRegistry();
    (registry as any).registry = new Map();
    const v1 = { ...makeSubGraph('sg', ['t'], ['r']), version: '1.0.0' };
    const v2 = { ...makeSubGraph('sg', ['t'], ['r']), version: '2.0.0', checksum: 'new' };
    registry.register(v1);
    registry.register(v2);
    expect(registry.getLatest('sg')?.version).toBe('2.0.0');
    expect(registry.listVersions('sg')).toEqual(['1.0.0', '2.0.0']);
  });

  it('hasChanged returns true when checksum differs', () => {
    const registry = new SubGraphRegistry();
    (registry as any).registry = new Map();
    const old = makeSubGraph('sg', ['t'], ['r']);
    registry.register(old);
    const updated = { ...old, checksum: 'different-checksum' };
    expect(registry.hasChanged(updated)).toBe(true);
  });

  it('hasChanged returns false when checksum is unchanged', () => {
    const registry = new SubGraphRegistry();
    (registry as any).registry = new Map();
    const sg = makeSubGraph('sg', ['t'], ['r']);
    registry.register(sg);
    expect(registry.hasChanged(sg)).toBe(false);
  });
});

describe('SubGraphCompiler (with mocked fs)', () => {
  it('generates default manifest when _subgraph.manifest.yaml is absent', async () => {
    // Mock readdir and readFile
    vi.mock('fs/promises', () => ({
      readdir: vi.fn().mockResolvedValue(['architect.md', 'developer.md']),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')), // no manifest
    }));

    const { SubGraphCompiler } = await import('../subgraph/subgraph-compiler.js');
    const compiled = await SubGraphCompiler.compile('/fake/engineering');
    expect(compiled.agentCount).toBe(2);
    expect(compiled.category).toBe('engineering');
    expect(compiled.inputKeys).toContain('task_description');
    expect(compiled.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

**Integration test:** 

1. Compile `.claude/agents/engineering/` and `.claude/agents/testing/` using `SubGraphCompiler`.
2. Assert `compiled.agentCount` matches actual `.md` file count.
3. Compose them sequentially; assert key contract validation passes.
4. Store composed topology to AgentDB; retrieve it; assert checksums match.
5. Run `swarm subgraph compile --dir .claude/agents/security --save` CLI command; assert output shows `Compiled SecuritySubGraph (N agents)`.

---

## 8. Definition of Done

- [ ] `SubGraph` interface, `CompiledSubGraph`, `AgentNode`, `Edge`, and `SubGraphManifest` types fully defined in `types.ts`.
- [ ] `SubGraphCompiler.compile` scans a `.claude/agents/<category>/` directory and produces a valid `CompiledSubGraph` with correct `agentCount`, `checksum`, `inputKeys`, and `outputKeys`.
- [ ] `_subgraph.manifest.yaml` files created for `engineering/`, `security/`, and `testing/` agent directories.
- [ ] `SubGraphCompiler` uses manifest when present; falls back to sensible defaults when absent.
- [ ] `SubGraphComposer.validateKeyContracts` correctly identifies unsatisfied key dependencies in sequential topologies.
- [ ] `SubGraphComposer.compose` generates connection edges for sequential mode and no connection edges for parallel mode.
- [ ] `SubGraphRegistry` tracks version history and correctly detects checksum changes.
- [ ] `compile_subgraph`, `compose_topology`, and `list_subgraphs` MCP tools added to `swarm-tools.ts`.
- [ ] `swarm subgraph list`, `compile`, `inspect`, and `compose` CLI subcommands implemented.
- [ ] AgentDB `storeSubGraph`, `getSubGraph`, and `listSubGraphs` methods implemented.
- [ ] All unit tests in `subgraph.test.ts` pass.
- [ ] SubGraph checksums are deterministic: compiling the same directory twice produces identical checksums when no files changed.
- [ ] TypeScript compiles with zero errors.
