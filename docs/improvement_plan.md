# Ruflo Agent System — Improvement Plan

> Generated: 2026-04-06  
> Source: 4-agent parallel swarm research across AutoGen, CrewAI, LangGraph, OpenHands, Agno,
> smolagents, Pydantic AI, Agency Swarm, Atomic Agents, DSPy, Semantic Router, Langfuse,
> AgentOps, Instructor + direct ruflo gap analysis  
> Scope: 230+ agents, 40+ MCP tools, HNSW/AgentDB memory, 17 hooks, 12 background workers

---

## Table of Contents

1. [Current State Summary](#1-current-state-summary)
2. [Gap Analysis](#2-gap-analysis)
3. [Improvement Catalogue](#3-improvement-catalogue)
   - [Tier 1 — Routing & Discovery](#tier-1--routing--discovery)
   - [Tier 2 — Memory Architecture](#tier-2--memory-architecture)
   - [Tier 3 — Typed Contracts & Validation](#tier-3--typed-contracts--validation)
   - [Tier 4 — Workflow & Orchestration Patterns](#tier-4--workflow--orchestration-patterns)
   - [Tier 5 — Observability & Cost](#tier-5--observability--cost)
   - [Tier 6 — Human-in-the-Loop & Safety](#tier-6--human-in-the-loop--safety)
   - [Tier 7 — Agent Resilience & Reliability](#tier-7--agent-resilience--reliability)
   - [Tier 8 — Prompt Quality & Optimization](#tier-8--prompt-quality--optimization)
   - [Tier 9 — Agent Composition & Synthesis](#tier-9--agent-composition--synthesis)
   - [Tier 10 — Testing & CI](#tier-10--testing--ci)
   - [Tier 11 — Versioning & Registry](#tier-11--versioning--registry)
4. [Implementation Priorities](#4-implementation-priorities)
5. [File & Directory Impact Map](#5-file--directory-impact-map)
6. [Cross-Improvement Dependencies](#6-cross-improvement-dependencies)

---

## 1. Current State Summary

### What Ruflo Has Today

| Capability | Implementation | Location |
|---|---|---|
| 230+ agent types | Markdown frontmatter files | `.claude/agents/**/*.md` |
| Agent spawning (MCP) | Zod-validated `ALLOWED_AGENT_TYPES` | `v3/mcp/tools/agent-tools.ts` |
| Routing | Hardcoded codes 1–13 in skill file | `.agents/skills/agent-coordination/SKILL.md` |
| Memory | AgentDB + HNSW vector search (150×–12,500×) | `v3/@claude-flow/memory/` |
| Swarm topologies | hierarchical, mesh, ring, star, adaptive | `v3/mcp/tools/` |
| Consensus | Byzantine (f<n/3), Raft (f<n/2), Gossip, CRDT, Quorum | `v3/mcp/tools/` |
| Background workers | 12 workers (ultralearn, optimize, audit, map, …) | `v3/@claude-flow/hooks/` |
| Hooks | 17 hooks (pre/post-task, session, route, intelligence) | `v3/@claude-flow/hooks/` |
| Neural learning | SONA, MoE, EWC++ | `v3/@claude-flow/memory/` |
| Plugin system | IPFS/Pinata registry, 20+ plugins | `v3/@claude-flow/cli/src/plugins/` |
| Skills | Static YAML skill definitions | `.agents/skills/` |
| Security | Input validation, path security, CVE remediation | `v3/@claude-flow/security/` |

### Known Gaps (from direct codebase analysis)

- Routing is hardcoded; no semantic matching of task descriptions to agent capabilities
- Memory is single-tier (HNSW only); no entity graph, episodic binning, or contextual summaries
- Agent outputs are raw strings; no typed I/O contracts or validation between agents
- No per-agent cost tracking or latency percentile monitoring
- No human-in-the-loop approval checkpoints in long-running swarms
- No agent state checkpointing for crash recovery
- No declarative workflow DSL (fan-out/fan-in, conditional branching)
- Agent definitions have no versioning or registry API
- No agent-specific test harness (TestModel, offline CI testing)
- Skills are static; agents cannot learn new procedures from successful executions
- No Dead Letter Queue for failed messages
- No causal trace spanning the full swarm execution graph

---

## 2. Gap Analysis

Comparison of ruflo versus AutoGen, CrewAI, LangGraph, OpenHands, and other modern systems:

| Domain | Ruflo Today | OSS State-of-the-Art | Gap Severity |
|---|---|---|---|
| **Routing** | Static codes 1–13 | Utterance-based RouteLayer (Semantic Router) | 🔴 Critical |
| **Memory tiers** | Single HNSW | Short/long/entity/contextual (CrewAI, Agno) | 🔴 Critical |
| **Typed I/O** | Raw strings | Pydantic schemas + auto-retry (Pydantic AI, Instructor) | 🔴 Critical |
| **Cost tracking** | None | Per-agent token+cost attribution (Langfuse, AgentOps) | 🔴 Critical |
| **Human oversight** | None | Graph-level interrupt + approval gates (LangGraph, AutoGen) | 🟠 High |
| **State recovery** | None | Full graph checkpointing + resume (LangGraph SqliteSaver) | 🟠 High |
| **Workflow DSL** | Parallel only | Fan-out/fan-in, conditional, loops (LangGraph StateGraph) | 🟠 High |
| **Agent testing** | General test suite | TestModel, offline deterministic CI (Pydantic AI) | 🟠 High |
| **Prompt optimization** | Hand-tuned static | BootstrapFewShot + MIPRO auto-optimization (DSPy) | 🟡 Medium |
| **Agent versioning** | None | Semantic versioned registry (OpenHands AgentHub) | 🟡 Medium |
| **Observability** | Hooks (disconnected) | Unified trace/span/generation hierarchy (Langfuse) | 🟡 Medium |
| **Communication flows** | Implicit/any-to-any | Declared directed graph (Agency Swarm) | 🟡 Medium |
| **Dynamic agent synthesis** | None | AutoBuild ephemeral agents (AutoGen) | 🟢 Nice-to-have |
| **Sandboxing** | None | Per-agent Docker/WASM runtime (OpenHands) | 🟢 Nice-to-have |
| **Procedural memory** | None | Skill learning from executions (AutoGen research) | 🟢 Nice-to-have |

---

## 3. Improvement Catalogue

---

### Tier 1 — Routing & Discovery

---

#### IMP-001: Semantic RouteLayer (Replace Hardcoded Routing Codes)

**Source:** Semantic Router (github.com/aurelio-labs/semantic-router)  
**Priority:** 🔴 Critical  
**Effort:** Low–Medium  

**Problem:**  
Routing in `.agents/skills/agent-coordination/SKILL.md` uses static codes 1–13 mapping task types to hardcoded agent lists. Adding a new agent requires editing the skill file. Phrasing variations in task descriptions silently misroute to wrong specialists.

**Solution:**  
Define a `Route` per agent specialty with 8–15 representative utterances. A `RouteLayer` embeds task descriptions at runtime and cosine-matches against route centroids. Threshold-gated LLM fallback handles low-confidence matches.

**Implementation Details:**

```typescript
// New file: v3/@claude-flow/routing/src/route-layer.ts

interface Route {
  name: string;           // agent slug or category
  utterances: string[];   // 8-15 representative task descriptions
  agentSlug: string;      // maps to ALLOWED_AGENT_TYPES entry
  threshold: number;      // min cosine similarity (default: 0.72)
  fallbackToLLM: boolean; // escalate to LLM classifier if below threshold
}

interface RouteLayer {
  routes: Route[];
  encoder: 'openai' | 'huggingface' | 'local';
  route(taskDescription: string): Promise<RouteResult>;
}

interface RouteResult {
  agentSlug: string;
  confidence: number;
  method: 'semantic' | 'keyword' | 'llm_fallback';
}
```

**Files to Create:**
- `v3/@claude-flow/routing/src/route-layer.ts` — RouteLayer implementation
- `v3/@claude-flow/routing/src/routes/` — one `.route.ts` file per agent category
- `v3/@claude-flow/routing/src/keyword-pre-filter.ts` — regex pre-filter for high-signal tokens

**Files to Modify:**
- `.agents/skills/agent-coordination/SKILL.md` — replace codes 1–13 table with RouteLayer reference
- `v3/@claude-flow/cli/src/commands/agent.ts` — hook RouteLayer into agent spawn command

**Route Definition Example:**
```typescript
// v3/@claude-flow/routing/src/routes/security.route.ts
export const securityRoute: Route = {
  name: 'security',
  agentSlug: 'engineering-security-engineer',
  threshold: 0.72,
  fallbackToLLM: true,
  utterances: [
    'audit the authentication system for vulnerabilities',
    'check for SQL injection risks in the API',
    'review JWT token handling security',
    'scan for CVEs in dependencies',
    'implement input sanitization',
    'find XSS vulnerabilities',
    'review OAuth flow security',
    'check for privilege escalation paths',
    'validate CORS configuration',
    'review cryptographic key management',
  ],
};
```

**Keyword Pre-filter Rules:**
```typescript
const KEYWORD_ROUTES: Array<{ pattern: RegExp; agentSlug: string }> = [
  { pattern: /\.(test|spec)\.[tj]s/i,        agentSlug: 'tdd-london-swarm' },
  { pattern: /Dockerfile|docker-compose/i,    agentSlug: 'engineering-devops-automator' },
  { pattern: /CVE-\d{4}-\d+/i,               agentSlug: 'engineering-security-engineer' },
  { pattern: /git (blame|log|rebase)/i,       agentSlug: 'engineering-git-workflow-master' },
  { pattern: /\.sol\b|solidity/i,             agentSlug: 'engineering-solidity-smart-contract-engineer' },
  { pattern: /lsp|language.server/i,          agentSlug: 'lsp-index-engineer' },
];
```

**Acceptance Criteria:**
- [ ] RouteLayer correctly routes 90%+ of a 100-task benchmark set
- [ ] Fallback rate < 10% (logged to observability)
- [ ] Adding a new agent requires only adding a `.route.ts` file, no skill file edit
- [ ] Routing latency < 50ms (async, local encoder)

---

#### IMP-002: Threshold-Gated LLM Fallback Routing

**Source:** Semantic Router dynamic routes  
**Priority:** 🟠 High  
**Effort:** Low  
**Depends on:** IMP-001  

**Problem:**  
Low-confidence semantic matches silently misroute to wrong specialists. Currently there is no second-chance path.

**Solution:**  
When no route scores above its threshold, escalate to a lightweight LLM classifier that receives the task description and a compact list of all agent capabilities, then returns the best match.

**Implementation Details:**
```typescript
// Fallback called when max(route.confidence) < route.threshold
async function llmFallbackRouter(
  taskDescription: string,
  availableAgents: AgentCapability[]
): Promise<RouteResult> {
  const prompt = buildClassificationPrompt(taskDescription, availableAgents);
  const result = await claudeHaiku(prompt); // cheap model, not Sonnet
  return parseRouteResult(result);
}
```

**Observability hook:** Log fallback rate per route to IMP-013 (cost tracking). Rising fallback rate on a specific route signals it needs more utterances.

---

#### IMP-003: Hybrid Semantic + Keyword Routing

**Source:** Semantic Router hybrid mode  
**Priority:** 🟠 High  
**Effort:** Low  
**Depends on:** IMP-001  

**Problem:**  
Pure embedding routing misses domain-specific tokens (`pytest`, `Dockerfile`, `CVE-2024-xxxx`) that are unambiguous high-signal task indicators.

**Solution:**  
Keyword regex pre-filter runs before RouteLayer. On match, short-circuits to the correct agent with `confidence=1.0`. RouteLayer handles everything else.

**Files to Modify:**
- `v3/@claude-flow/routing/src/keyword-pre-filter.ts` (created in IMP-001)

---

#### IMP-004: Structured Agent Capability Metadata

**Source:** CrewAI role/goal/backstory + OpenHands AgentHub  
**Priority:** 🟠 High  
**Effort:** Low  

**Problem:**  
HNSW indexes raw system prompt text from 230+ agent files. Embedding quality is poor because system prompts mix instructions, examples, and workflows — not capability signals.

**Solution:**  
Add a structured `[capability]` section to every agent frontmatter. HNSW is re-indexed from these structured fields, dramatically improving retrieval precision.

**Frontmatter Addition:**
```yaml
---
name: Security Engineer
description: ...existing description...
tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
# NEW FIELDS:
capability:
  role: security-engineer
  goal: Identify and remediate security vulnerabilities in code and infrastructure
  expertise:
    - application security
    - OWASP Top 10
    - CVE analysis
    - cryptography
    - authentication systems
  task_types:
    - security-audit
    - vulnerability-scan
    - penetration-testing
    - dependency-review
  output_type: SecurityAuditReport
---
```

**Files to Modify:**
- All 230+ files in `.claude/agents/**/*.md` — add `capability:` block to frontmatter
- `v3/@claude-flow/memory/src/indexer.ts` — index `capability.*` fields instead of full system prompt

---

#### IMP-005: Agent Specialization Scoring

**Source:** CrewAI task success history  
**Priority:** 🟡 Medium  
**Depends on:** IMP-001, IMP-013  

**Problem:**  
All agents are treated equally when multiple could handle a task. No data about which agent succeeds at which task type.

**Solution:**  
Track per-agent success rate by `task_type` tag. When routing produces multiple candidates above threshold, prefer the one with the highest specialization score for that category. Score decays over time to handle agent updates.

**Data Schema:**
```sql
CREATE TABLE agent_specialization_scores (
  agent_slug TEXT,
  task_type  TEXT,
  success_count  INTEGER DEFAULT 0,
  failure_count  INTEGER DEFAULT 0,
  avg_latency_ms REAL,
  last_updated   TIMESTAMP,
  PRIMARY KEY (agent_slug, task_type)
);
```

---

### Tier 2 — Memory Architecture

---

#### IMP-006: Multi-Tier Memory Architecture

**Source:** CrewAI (short/long/entity/contextual) + Agno AgentMemory  
**Priority:** 🔴 Critical  
**Effort:** Medium  

**Problem:**  
Ruflo has a single HNSW vector tier. CrewAI and Agno demonstrate that a single tier forces trade-offs: fast retrieval with low precision (too many chunks), or high precision at the cost of context window bloat (too much returned).

**Solution:**  
Layer four memory namespaces on top of AgentDB:

| Tier | Storage | Scope | TTL | Purpose |
|---|---|---|---|---|
| **Short-term** | In-memory buffer | Per-run | End of run | Fast scratch for current task |
| **Long-term** | Persistent HNSW partition | Per-agent | Permanent | Cross-run learning |
| **Entity** | SQLite KV store | Shared | Configurable | Named entity facts |
| **Contextual** | Compressed HNSW embeddings | Per-session | Session | Rolling summaries of past runs |

**Implementation Details:**
```typescript
// v3/@claude-flow/memory/src/tiers/

interface ShortTermMemory {
  buffer: Map<string, MemoryEntry>;
  flush(): Promise<void>; // writes to long-term on run end
}

interface EntityMemory {
  store(entity: string, fact: string, confidence: number): Promise<void>;
  retrieve(entity: string): Promise<EntityFact[]>;
  update(entity: string, fact: string): Promise<void>;
}

interface ContextualMemory {
  summarize(runs: AgentRun[]): Promise<string>; // uses cheap model
  retrieveContext(query: string, maxTokens: number): Promise<string>;
}
```

**Files to Create:**
- `v3/@claude-flow/memory/src/tiers/short-term.ts`
- `v3/@claude-flow/memory/src/tiers/entity.ts`
- `v3/@claude-flow/memory/src/tiers/contextual.ts`
- `v3/@claude-flow/memory/src/tier-manager.ts` — routes queries to appropriate tier

**Files to Modify:**
- `v3/@claude-flow/memory/src/agent-db.ts` — integrate TierManager
- `v3/@claude-flow/hooks/src/workers/consolidate.ts` — trigger contextual summarization

---

#### IMP-007: Entity Memory (Knowledge Graph)

**Source:** CrewAI entity memory + LangGraph entity extraction  
**Priority:** 🟠 High  
**Effort:** Medium  
**Depends on:** IMP-006  

**Problem:**  
No structured knowledge about named entities (files, APIs, users, repos, vulnerabilities). Agents repeatedly re-derive facts about the same entities from raw vector chunks.

**Solution:**  
SQLite KV store with entity → fact mappings. A background `EntityExtractorWorker` runs after each agent completes and extracts entity facts from the run transcript.

```typescript
interface EntityFact {
  entity: string;         // e.g., "src/auth/jwt.ts"
  factType: string;       // e.g., "uses_library", "has_vulnerability", "owner"
  value: string;          // e.g., "jsonwebtoken@8.5.1"
  confidence: number;     // 0.0–1.0
  sourceRunId: string;
  createdAt: Date;
  expiresAt?: Date;
}
```

**Background Worker:**
```typescript
// v3/@claude-flow/hooks/src/workers/entity-extractor.ts
class EntityExtractorWorker extends BackgroundWorker {
  priority = 'normal';
  
  async process(runTranscript: string): Promise<void> {
    const facts = await extractEntities(runTranscript); // LLM call, cheap model
    for (const fact of facts) {
      await entityMemory.store(fact.entity, fact.factType, fact.value);
    }
  }
}
```

---

#### IMP-008: Episodic Memory with Temporal Binning

**Source:** CrewAI long-term memory + Agno run log  
**Priority:** 🟠 High  
**Effort:** Medium  
**Depends on:** IMP-006  

**Problem:**  
Ruflo returns raw vector chunks on retrieval. For long-running workflows, this produces high-token-overhead context that often misses coherent conversational context.

**Solution:**  
Bin agent memories into episodes (by `session_id` or task run boundary). On retrieval, return whole episode summaries rather than raw chunks. Episode summaries are compressed by the contextual memory tier (IMP-006).

```typescript
interface Episode {
  episodeId: string;
  sessionId: string;
  runIds: string[];
  summary: string;        // compressed by cheap model
  startedAt: Date;
  endedAt: Date;
  agentSlugs: string[];
  taskTypes: string[];
}
```

**Retrieval change:** `memory.search(query)` returns ranked episodes, not raw chunks. Caller controls `maxEpisodes` to bound context window usage.

---

#### IMP-009: Per-Agent Knowledge Base with Pre-indexed Documents

**Source:** Agno knowledge base + CrewAI knowledge_sources  
**Priority:** 🟡 Medium  
**Effort:** Medium  

**Problem:**  
Agents re-read the same large reference files (architecture docs, API specs, style guides) on every invocation, wasting tokens.

**Solution:**  
Each specialist agent gets a pre-indexed knowledge base stored in a dedicated HNSW partition. A shared knowledge base is queried first (project-wide conventions), then the agent-private partition.

**Frontmatter Addition:**
```yaml
capability:
  knowledge_sources:
    shared:
      - "docs/architecture.md"
      - "docs/api-spec.yaml"
    private:
      - "docs/security-guidelines.md"
      - "docs/threat-model.md"
```

**KnowledgeWorker** (new background worker #13):
- Indexes all declared `knowledge_sources` at agent startup
- Watches for changes and re-indexes incrementally
- Partitions: `scope=shared` (all agents), `scope=<agent_slug>` (private)

---

#### IMP-010: Procedural Memory — Learn from Successful Executions

**Source:** AutoGen research systems  
**Priority:** 🟢 Future  
**Effort:** High  

**Problem:**  
Skills are static YAML definitions. Agents cannot encode "how to do X" patterns derived from successful past runs.

**Solution:**  
A `ProcedureExtractorWorker` identifies repeated successful action sequences across runs and encodes them as new skill definitions written to `.agents/skills/learned/`.

```typescript
// Extracted after N successful runs with the same action sequence
interface LearnedSkill {
  name: string;
  trigger: string;          // task description pattern that activates this skill
  actionSequence: Action[]; // ordered list of tools + prompts that succeeded
  successCount: number;
  avgQualityScore: number;
  sourceRunIds: string[];
}
```

---

### Tier 3 — Typed Contracts & Validation

---

#### IMP-011: Typed Agent I/O Contracts

**Source:** Pydantic AI `Agent[Deps, Result]` + Atomic Agents `BaseIOSchema` + CrewAI `output_pydantic`  
**Priority:** 🔴 Critical  
**Effort:** Medium  

**Problem:**  
Inter-agent messages are raw strings. Schema changes in one agent silently break downstream agents until a runtime failure occurs.

**Solution:**  
Define Pydantic `input_schema` and `output_schema` for every agent. Orchestrator validates that `output_schema` of agent A is assignable to `input_schema` of agent B at graph construction time, not execution time.

**Frontmatter Addition:**
```yaml
capability:
  input_schema: "schemas/code-review-input.json"
  output_schema: "schemas/code-review-output.json"
```

**Schema File Example:**
```json
// .claude/agents/schemas/code-review-output.json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "type": "object",
  "required": ["findings", "summary", "severity"],
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "line", "description", "severity"],
        "properties": {
          "file":        { "type": "string" },
          "line":        { "type": "integer" },
          "description": { "type": "string" },
          "severity":    { "enum": ["low", "medium", "high", "critical"] }
        }
      }
    },
    "summary":  { "type": "string" },
    "severity": { "enum": ["low", "medium", "high", "critical"] }
  }
}
```

**Files to Create:**
- `.claude/agents/schemas/` — JSON Schema files per agent output type
- `v3/@claude-flow/shared/src/schema-validator.ts` — validates agent I/O at handoff points

**Validation Flow:**
```
AgentA produces output
  → SchemaValidator.validate(output, AgentA.output_schema)
  → On failure: re-prompt AgentA with ValidationError details (max 3 retries)
  → On success: forward to AgentB
  → SchemaValidator.validate(output, AgentB.input_schema) before injection
```

---

#### IMP-012: Structured Output Auto-Retry (Instructor Pattern)

**Source:** Instructor `max_retries` + Pydantic AI `result_type`  
**Priority:** 🔴 Critical  
**Effort:** Low  
**Depends on:** IMP-011  

**Problem:**  
A single validation failure aborts the entire agent pipeline with no recovery path, losing all upstream work.

**Solution:**  
On `ValidationError`, automatically re-prompt the agent with the specific field errors appended. Bounded retry (max 3). Log each retry as an observability event.

```typescript
async function runAgentWithRetry<T>(
  agent: Agent,
  task: string,
  outputSchema: ZodSchema<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: ValidationError | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const raw = await agent.run(task + (lastError ? `\n\nFix these errors:\n${lastError.message}` : ''));
    const result = outputSchema.safeParse(raw);
    
    if (result.success) return result.data;
    lastError = result.error;
    
    // Log retry to observability (IMP-013)
    observability.logRetry(agent.slug, attempt, lastError.message);
  }
  
  // Graceful degradation: emit AgentErrorResult instead of throwing
  return { error: lastError, agentSlug: agent.slug, partialOutput: lastError } as any;
}
```

---

#### IMP-013: Shared Agency Instructions (Convention Propagation)

**Source:** Agency Swarm `shared_instructions`  
**Priority:** 🟡 Medium  
**Effort:** Low  

**Problem:**  
When project-wide conventions change (new coding standard, security policy), every agent's system prompt must be updated individually, causing drift.

**Solution:**  
A `shared_instructions.md` file is prepended to every agent's system prompt at runtime. Updating it propagates to all agents immediately.

**Files to Create:**
- `.agents/shared_instructions.md` — project-wide behavioral contracts

**Example Content:**
```markdown
# Project-Wide Agent Instructions

## Code Standards
- All TypeScript: strict mode, no `any` types
- Test files: Jest, describe/it pattern, no `test()` at top level
- Imports: named imports only, no default imports from internal modules

## Security Rules
- Never log secrets or API keys
- Always validate inputs at system boundaries
- Use parameterized queries for all DB operations

## Communication
- Always structure findings as JSON with `severity`, `description`, `file`, `line`
- When uncertain, say so explicitly — do not guess
```

---

#### IMP-014: Communication Flows as Explicit Graph Edges

**Source:** Agency Swarm `communication_flows`  
**Priority:** 🟡 Medium  
**Effort:** Medium  

**Problem:**  
Any agent can message any other agent, making the communication topology implicit and impossible to audit.

**Solution:**  
Declare `communication_flows` as a directed graph in the swarm configuration. The orchestrator enforces these edges — unauthorized paths raise an exception.

**Swarm Config Addition:**
```json
{
  "topology": "hierarchical",
  "communication_flows": [
    ["hierarchical-coordinator", "engineering-backend-architect"],
    ["hierarchical-coordinator", "tdd-london-swarm"],
    ["engineering-backend-architect", "engineering-code-reviewer"],
    ["tdd-london-swarm", "engineering-code-reviewer"],
    ["engineering-code-reviewer", "hierarchical-coordinator"]
  ]
}
```

---

### Tier 4 — Workflow & Orchestration Patterns

---

#### IMP-015: Task Context Dependency Graph (DAG)

**Source:** CrewAI `Task(context=[other_tasks])`  
**Priority:** 🟠 High  
**Effort:** Medium  

**Problem:**  
Dependency wiring between tasks is implicit or hard-coded in orchestrator logic. Tasks that could parallelize are serialized; tasks that must be sequential are not enforced.

**Solution:**  
Add `context_deps: [task_id, ...]` to the task schema. Orchestrator builds a DAG, runs tasks in topological order, and injects resolved upstream outputs into each agent's context before execution.

**Task Schema Addition:**
```typescript
interface Task {
  id: string;
  description: string;
  agentSlug: string;
  context_deps?: string[];   // task IDs whose output this task needs
  output_schema?: string;    // JSON Schema file reference
  timeout_ms?: number;
  retry_policy?: RetryPolicy;
}
```

**DAG Execution:**
```typescript
class DAGOrchestrator {
  async execute(tasks: Task[]): Promise<TaskResults> {
    const dag = buildDAG(tasks);
    const levels = topologicalSort(dag); // tasks at same level run in parallel
    
    for (const level of levels) {
      const results = await Promise.all(
        level.map(task => this.runTask(task, this.resolveContext(task, dag)))
      );
      this.storeResults(results);
    }
  }
}
```

**Files to Modify:**
- `v3/mcp/tools/agent-tools.ts` — add `context_deps` to task spawn schema
- `v3/@claude-flow/cli/src/commands/task.ts` — DAG builder and executor

---

#### IMP-016: TypedDict Swarm State with Reducer Annotations

**Source:** LangGraph `TypedDict` + `Annotated[list, operator.add]`  
**Priority:** 🟠 High  
**Effort:** Medium  

**Problem:**  
Shared state passed between agents is an untyped dict/JSON blob. Parallel agents silently overwrite each other's outputs.

**Solution:**  
Define `SwarmState` as a typed interface with declared merge semantics per key. Raft consensus layer uses reducer annotations to safely merge parallel agent outputs.

```typescript
// v3/@claude-flow/shared/src/swarm-state.ts

type Reducer<T> = (a: T, b: T) => T;

interface SwarmStateField<T> {
  value: T;
  reducer: Reducer<T>;  // 'append' | 'last_write' | 'merge_unique' | custom fn
}

interface SwarmState {
  messages:  SwarmStateField<Message[]>;     // reducer: append
  findings:  SwarmStateField<Finding[]>;     // reducer: append
  consensus: SwarmStateField<ConsensusVote>; // reducer: raft_merge
  errors:    SwarmStateField<AgentError[]>;  // reducer: append
  metadata:  SwarmStateField<Record<string, unknown>>; // reducer: deep_merge
}
```

---

#### IMP-017: Declarative Workflow DSL (Fan-out/Fan-in, Conditional, Loop)

**Source:** LangGraph `Send` API + conditional edges  
**Priority:** 🟠 High  
**Effort:** High  
**Depends on:** IMP-015, IMP-016  

**Problem:**  
Complex workflows (analyze N documents in parallel, then reduce; run security scan only if build passes; retry failed tests up to 3 times) require manual agent coordination code.

**Solution:**  
Expose a workflow DSL as a JSON/YAML config or TypeScript builder supporting:
- `parallel(tasks[])` — fan-out, wait for all
- `sequence(tasks[])` — serial execution
- `conditional(condition, ifTrue, ifFalse)` — runtime branching
- `mapReduce(items[], mapAgent, reduceAgent)` — dynamic N-way fan-out
- `loop(condition, body, maxIterations)` — bounded retry/refinement loops

**Workflow DSL Example:**
```yaml
# .claude/workflows/security-audit.yaml
name: security-audit
steps:
  - id: build-check
    agent: engineering-devops-automator
    task: "Run build and return pass/fail"
  
  - id: parallel-scans
    type: conditional
    condition: "{{build-check.status == 'pass'}}"
    if_true:
      type: parallel
      steps:
        - agent: engineering-security-engineer
          task: "Scan {{input.target}} for vulnerabilities"
        - agent: testing-api-tester
          task: "Run API security tests against {{input.target}}"
    if_false:
      - agent: engineering-code-reviewer
        task: "Review build failures in {{build-check.output}}"
  
  - id: synthesize
    agent: hierarchical-coordinator
    task: "Synthesize security findings"
    context_deps: [parallel-scans]
```

**Files to Create:**
- `v3/@claude-flow/cli/src/workflow/dsl-parser.ts`
- `v3/@claude-flow/cli/src/workflow/executor.ts`
- `v3/@claude-flow/cli/src/workflow/map-reduce-worker.ts`
- `.claude/workflows/` — directory for workflow YAML files

---

#### IMP-018: SubGraph Composition (Modular Topology Design)

**Source:** LangGraph subgraphs  
**Priority:** 🟡 Medium  
**Effort:** Medium  
**Depends on:** IMP-017  

**Problem:**  
Swarm topology is monolithic. Can't independently version, test, or compose topology units.

**Solution:**  
Each agent category subdirectory (`.claude/agents/engineering/`, `.claude/agents/security/`, etc.) becomes a `SubGraph` — an independently compilable, testable state machine. Top-level orchestrator composes SubGraphs via declared node additions.

```typescript
interface SubGraph {
  id: string;
  agents: AgentNode[];
  internalEdges: Edge[];
  inputKeys: string[];   // keys this SubGraph reads from parent state
  outputKeys: string[];  // keys this SubGraph writes to parent state
  compile(): CompiledSubGraph;
}
```

---

#### IMP-019: Isolated Thread per Agent Pair

**Source:** Agency Swarm  
**Priority:** 🟡 Medium  
**Effort:** Medium  

**Problem:**  
Multiple agent pairs communicating concurrently bleed conversation histories into each other's context, causing confusion and inflated context windows.

**Solution:**  
Maintain a separate isolated conversation thread for each directed agent pair. No agent sees conversations it was not party to. This bounds context window usage and eliminates cross-contamination.

```typescript
class ThreadedMessageBus {
  private threads: Map<string, ConversationThread>; // key: `${from}:${to}`
  
  getThread(from: AgentId, to: AgentId): ConversationThread {
    const key = `${from}:${to}`;
    if (!this.threads.has(key)) {
      this.threads.set(key, new ConversationThread(from, to));
    }
    return this.threads.get(key)!;
  }
}
```

---

#### IMP-020: Three-Mode Team Routing (route / coordinate / collaborate)

**Source:** Agno Team class  
**Priority:** 🟡 Medium  
**Effort:** Low  

**Problem:**  
All agent delegation is ad hoc. No explicit concept of whether the orchestrator is dispatching-and-forgetting, fan-out-collecting, or co-authoring.

**Solution:**  
Three explicit orchestration modes selectable at task-creation time:

| Mode | Behavior | Use Case |
|---|---|---|
| `route` | Dispatch to one specialist, no return path | Simple single-agent tasks |
| `coordinate` | Break into subtasks, fan-out, collect + synthesize | Multi-step analyses |
| `collaborate` | Shared scratchpad, iterative co-refinement | Code review cycles |

**Files to Modify:**
- `v3/mcp/tools/agent-tools.ts` — add `orchestration_mode` to spawn schema

---

### Tier 5 — Observability & Cost

---

#### IMP-021: Per-Agent Cost + Token Tracking

**Source:** Langfuse Generation records + AgentOps  
**Priority:** 🔴 Critical  
**Effort:** Low  

**Problem:**  
Total Claude API costs are visible but attribution to specific agents or task types is opaque. Can't enforce per-agent budgets or identify cost outliers.

**Solution:**  
Wrap every Claude call inside an agent with a generation record. Track `input_tokens`, `output_tokens`, `cost_usd` per `agent_id` per `task_type`.

**Data Schema:**
```sql
CREATE TABLE agent_cost_records (
  id           TEXT PRIMARY KEY,
  agent_slug   TEXT NOT NULL,
  task_type    TEXT,
  task_id      TEXT,
  model        TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd     REAL,
  latency_ms   INTEGER,
  retry_count  INTEGER DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cost_agent_slug ON agent_cost_records(agent_slug);
CREATE INDEX idx_cost_task_type  ON agent_cost_records(task_type);
```

**Integration Points:**
- Hook into `v3/@claude-flow/hooks/src/hooks/post-task.ts` — record after each agent completes
- New CLI command: `npx claude-flow@v3alpha cost report --group-by agent --period 7d`
- Budget alerts: configurable `max_cost_per_call` per agent slug in `claude-flow.config.json`

---

#### IMP-022: Distributed Trace Hierarchy (Swarm Execution Observability)

**Source:** Langfuse Trace/Span/Generation hierarchy + AgentOps multi-agent session linking  
**Priority:** 🟠 High  
**Effort:** Medium  

**Problem:**  
In a swarm of 5+ concurrent agents, it is impossible to reconstruct which agent did what, in what order, and why. The 17 hooks produce disconnected telemetry.

**Solution:**  
Create a single `Trace` per user task. Each spawned agent creates a child `Span`. Tool calls are `Generation` or `Event` records nested under the agent span. All emitted via the existing 17 hooks as typed events.

```typescript
// v3/@claude-flow/hooks/src/observability/trace.ts

interface Trace {
  traceId: string;
  sessionId: string;
  taskDescription: string;
  startedAt: Date;
  spans: AgentSpan[];
}

interface AgentSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;  // for nested sub-swarms
  agentSlug: string;
  startedAt: Date;
  endedAt?: Date;
  tokenUsage?: TokenUsage;
  toolCalls: ToolCallEvent[];
  retryCount: number;
  status: 'running' | 'success' | 'error';
}
```

**Hook Integration:** All 17 hooks emit `TraceEvent` objects to a central `ObservabilityBus` (IMP-025).

---

#### IMP-023: Latency Percentile Monitoring Per Agent

**Source:** Langfuse latency views  
**Priority:** 🟡 Medium  
**Effort:** Low  
**Depends on:** IMP-021, IMP-022  

**Problem:**  
Average latency hides p95/p99 tail latency problems that block entire orchestration pipelines.

**Solution:**  
From `agent_cost_records` (IMP-021), compute p50/p95/p99 per agent per time window. Alert when p95 > threshold.

```sql
SELECT
  agent_slug,
  PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY latency_ms) AS p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99
FROM agent_cost_records
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY agent_slug
ORDER BY p95 DESC;
```

---

#### IMP-024: Session Replay for Failure Diagnosis

**Source:** AgentOps session replay  
**Priority:** 🟡 Medium  
**Effort:** Medium  
**Depends on:** IMP-022  

**Problem:**  
When an agent fails in production, reproducing the exact sequence of LLM calls, tool invocations, and state transitions is manual and slow.

**Solution:**  
Every LLM call, tool use, and lifecycle event is captured in the `Trace` (IMP-022). A `replay` CLI command reconstructs the exact sequence with timestamps, token counts, and tool call details.

```bash
npx claude-flow@v3alpha replay --trace-id <id>
npx claude-flow@v3alpha replay --trace-id <id> --from-span <span-id>
```

---

#### IMP-025: Unified Observability Bus

**Source:** OpenHands EventStream + LangGraph streaming + AutoGen conversation logs  
**Priority:** 🟠 High  
**Effort:** Medium  
**Depends on:** IMP-022  

**Problem:**  
17 hooks, background workers, and MCP tool calls produce disconnected telemetry with no single view.

**Solution:**  
A single `ObservabilityBus` multiplexes: (a) all 17 hooks fire as typed events, (b) LangGraph-style streaming emits state diffs to CLI, (c) background workers publish heartbeat and result events.

```typescript
// v3/@claude-flow/hooks/src/observability/bus.ts

type ObservabilityEvent =
  | { type: 'agent.start';    agentSlug: string; taskId: string }
  | { type: 'agent.complete'; agentSlug: string; taskId: string; tokens: TokenUsage }
  | { type: 'agent.error';    agentSlug: string; taskId: string; error: string }
  | { type: 'tool.call';      agentSlug: string; tool: string; input: unknown }
  | { type: 'tool.result';    agentSlug: string; tool: string; output: unknown; latencyMs: number }
  | { type: 'retry';          agentSlug: string; attempt: number; reason: string }
  | { type: 'checkpoint';     swarmId: string; step: number; stateHash: string }
  | { type: 'consensus';      protocol: string; decision: unknown; quorumAchieved: boolean };

class ObservabilityBus {
  subscribe(handler: (event: ObservabilityEvent) => void): Unsubscribe;
  publish(event: ObservabilityEvent): void;
  
  // Sinks
  writeToAgentDB(event: ObservabilityEvent): void;
  streamToCLI(event: ObservabilityEvent): void;     // real-time TUI output
  forwardToOTel(event: ObservabilityEvent): void;   // optional OpenTelemetry export
}
```

---

#### IMP-026: Prompt Version Management

**Source:** Langfuse prompt management  
**Priority:** 🟡 Medium  
**Effort:** Low  

**Problem:**  
Agent system prompts are string literals in `.claude/agents/*.md`. Changes are not tracked beyond git. A/B testing requires manual infrastructure.

**Solution:**  
Store prompt versions in AgentDB with semantic version tags. Agents fetch their active prompt version at startup. Track which version was active per trace.

```typescript
interface PromptVersion {
  agentSlug: string;
  version: string;     // semver: "1.3.0"
  prompt: string;
  activeFrom: Date;
  activeTo?: Date;
  qualityScore?: number; // set after eval runs
}

// A/B testing: route X% of spawns to candidate version
interface PromptExperiment {
  agentSlug: string;
  control: string;   // version "1.2.0"
  candidate: string; // version "1.3.0"
  trafficPct: number; // 0.0–1.0, candidate share
}
```

---

### Tier 6 — Human-in-the-Loop & Safety

---

#### IMP-027: Graph-Level Interrupt + Approval Gates

**Source:** LangGraph `interrupt()` + AutoGen `human_input_mode`  
**Priority:** 🟠 High  
**Effort:** Medium  

**Problem:**  
Agents run to completion with no built-in point for human review or redirection. High-risk agents (e.g., those with write access to production systems) execute without confirmation.

**Solution:**  
Add `interrupt_before: [agent_slug]` to swarm configuration. Before invoking a flagged agent, the orchestrator serializes full graph state to AgentDB and surfaces a pause in the Claude Code CLI session. The graph resumes from that exact checkpoint on approval.

**Config Example:**
```json
{
  "interrupt_before": [
    "engineering-devops-automator",
    "engineering-solidity-smart-contract-engineer"
  ],
  "interrupt_on_low_confidence": true,
  "confidence_threshold": 0.65
}
```

**CLI Interaction:**
```
[RUFLO] About to invoke: engineering-devops-automator
[RUFLO] Task: "Deploy updated auth service to staging"
[RUFLO] Checkpoint saved: chk_abc123
[RUFLO] Approve? (y/n/edit task): _
```

**Files to Modify:**
- `v3/mcp/tools/agent-tools.ts` — intercept spawn calls for flagged agents
- `v3/@claude-flow/cli/src/interactive/interrupt.ts` — new interactive interrupt UI

---

#### IMP-028: Mandatory Planning Step Before Execution

**Source:** smolagents `planning_step`  
**Priority:** 🟡 Medium  
**Effort:** Low  

**Problem:**  
Agents dive into execution without a verifiable plan. Tokens are spent on wrong work before a human could redirect.

**Solution:**  
Insert a mandatory `planning_step` at the start of every multi-step agent run. The agent outputs a numbered plan (files to touch, tools to call, expected outputs). Configurable: auto-approve in CI mode, require human confirmation in interactive mode.

**Frontmatter Addition:**
```yaml
capability:
  planning_step: required    # 'required' | 'optional' | 'disabled'
  plan_format: numbered-list # 'numbered-list' | 'json' | 'markdown'
```

---

#### IMP-029: Per-Agent Termination Conditions

**Source:** AutoGen `is_termination_msg`, `max_consecutive_auto_reply`  
**Priority:** 🟡 Medium  
**Effort:** Low  

**Problem:**  
Long-running swarms risk runaway loops or infinite delegation chains. No per-agent stopping criteria.

**Solution:**  
Add `TerminationPolicy` to agent definitions. Background workers check policies at each tick; Raft consensus propagates a global `HALT` signal when any agent triggers a termination condition.

**Frontmatter Addition:**
```yaml
capability:
  termination:
    max_turns: 20
    max_cost_usd: 0.50
    timeout_ms: 120000
    stop_on_phrases:
      - "TASK_COMPLETE"
      - "CANNOT_PROCEED"
```

---

#### IMP-030: Confidence-Gated Human Input

**Source:** AutoGen `human_input_mode`  
**Priority:** 🟡 Medium  
**Effort:** Low  
**Depends on:** IMP-027  

**Problem:**  
Agents proceed even when their own confidence in the correct action is low, leading to expensive mistakes.

**Solution:**  
When an agent's self-reported confidence score drops below a threshold, pause that agent's queue and surface a prompt to the Claude Code CLI session. Agent resumes when the user responds.

---

### Tier 7 — Agent Resilience & Reliability

---

#### IMP-031: Full Graph Checkpointing + Resume

**Source:** LangGraph `SqliteSaver` + AutoGen state serialization  
**Priority:** 🟠 High  
**Effort:** Medium  

**Problem:**  
Background workers that crash lose all in-progress context. No full graph replay capability.

**Solution:**  
`SwarmCheckpointer` writes complete swarm state (all agent states + orchestrator state + message queues) to AgentDB at each topology step. On crash/restart, rehydrate from the latest checkpoint.

```typescript
// v3/@claude-flow/hooks/src/checkpointer.ts

interface SwarmCheckpoint {
  checkpointId: string;
  swarmId: string;
  step: number;
  agentStates: Map<AgentId, AgentState>;
  messageQueues: Map<AgentId, Message[]>;
  taskResults: Map<TaskId, TaskResult>;
  consensusState: ConsensusState;
  createdAt: Date;
}

class SwarmCheckpointer {
  async save(swarm: SwarmState): Promise<string>; // returns checkpointId
  async load(checkpointId: string): Promise<SwarmCheckpoint>;
  async resume(checkpointId: string): Promise<void>;
  async listCheckpoints(swarmId: string): Promise<SwarmCheckpoint[]>;
}
```

**CLI Commands:**
```bash
npx claude-flow@v3alpha checkpoint list --swarm-id <id>
npx claude-flow@v3alpha checkpoint resume --checkpoint-id <id>
npx claude-flow@v3alpha checkpoint diff --from <chk_a> --to <chk_b>
```

---

#### IMP-032: Dead Letter Queue + Message Forensics

**Source:** Production message bus patterns  
**Priority:** 🟠 High  
**Effort:** Low  

**Problem:**  
Failed messages are dropped with no record. Intermittent failures are undiagnosable.

**Solution:**  
Failed messages (after exhausting `maxRetryAttempts`) are moved to a DLQ in AgentDB with full delivery attempt history. A `dlq` CLI command exposes these for inspection and replay.

```typescript
interface DLQEntry {
  messageId: string;
  originalMessage: Message;
  deliveryAttempts: DeliveryAttempt[];
  finalError: string;
  createdAt: Date;
  archivedAt: Date;
}
```

**CLI Commands:**
```bash
npx claude-flow@v3alpha dlq list
npx claude-flow@v3alpha dlq inspect --message-id <id>
npx claude-flow@v3alpha dlq replay --message-id <id>
npx claude-flow@v3alpha dlq purge --older-than 7d
```

---

#### IMP-033: Tool Failure Retry with Exponential Backoff

**Source:** Instructor + AutoGen tool retry  
**Priority:** 🟠 High  
**Effort:** Low  

**Problem:**  
Transient failures (rate limits, timeouts) cause immediate task failure. No per-tool retry policies.

**Solution:**  
Per-tool retry configuration with exponential backoff + jitter. Falls back to a simpler alternative tool if available.

```typescript
interface RetryPolicy {
  maxAttempts: number;      // default: 3
  initialDelayMs: number;   // default: 1000
  backoffMultiplier: number;// default: 2.0
  jitterMs: number;         // default: 500
  fallbackTool?: string;    // e.g., 'WebSearch' falls back to 'WebFetch'
  retryOn: string[];        // error types: 'RATE_LIMIT' | 'TIMEOUT' | 'VALIDATION'
}
```

---

#### IMP-034: Per-Agent Runtime Sandboxing

**Source:** OpenHands Docker/WASM runtime  
**Priority:** 🟢 Future  
**Effort:** High  

**Problem:**  
Agents with shell access share the host environment, creating security and interference risks.

**Solution:**  
A `sandbox` field in agent frontmatter provisions an isolated runtime:

```yaml
capability:
  sandbox: docker   # 'docker' | 'wasm' | 'none'
  sandbox_config:
    image: "node:20-alpine"
    allowed_paths:
      - "/workspace"
    network: none
    cpu_limit: "0.5"
    memory_limit: "512m"
```

---

#### IMP-035: Consensus Proof + Voting Audit Log

**Source:** Distributed systems best practices  
**Priority:** 🟡 Medium  
**Effort:** Medium  

**Problem:**  
Byzantine/Raft/Gossip consensus is implemented but decisions are not auditable. Can't prove quorum was achieved.

**Solution:**  
Each consensus decision writes a signed audit record to AgentDB.

```typescript
interface ConsensusAuditRecord {
  decisionId: string;
  protocol: 'byzantine' | 'raft' | 'gossip';
  decision: unknown;
  votes: Array<{ agentId: string; vote: unknown; signature: string }>;
  quorumAchieved: boolean;
  quorumThreshold: number;
  timestamp: Date;
}
```

---

### Tier 8 — Prompt Quality & Optimization

---

#### IMP-036: Automatic Few-Shot Prompt Optimization (BootstrapFewShot)

**Source:** DSPy BootstrapFewShot  
**Priority:** 🟡 Medium  
**Effort:** High  

**Problem:**  
Agent prompts are hand-tuned once and never improved from real execution data.

**Solution:**  
Collect passing agent executions (task + output + quality rating) into a dataset. Run `BootstrapFewShot` with a quality metric to select the highest-quality few-shot examples. Prepend to agent system prompts. Re-run weekly on the last 500 traces.

**Optimization Pipeline:**
```
1. Collect traces with quality scores > 0.8 from IMP-021
2. Build (input, output) pairs per agent_slug
3. Run BootstrapFewShot with quality_metric(output) → score
4. Select top-K examples that maximize metric
5. Write to PromptVersion (IMP-026) as new version
6. A/B test new vs. old version (IMP-026 experiment config)
7. Promote if quality score improves > 2%
```

**New CLI Command:**
```bash
npx claude-flow@v3alpha optimize prompt --agent <slug> --period 30d --dry-run
npx claude-flow@v3alpha optimize prompt --agent <slug> --period 30d --promote
```

---

#### IMP-037: Dynamic System Prompt Assembly

**Source:** Pydantic AI `system_prompt` function + Atomic Agents `SystemPromptContextProvider`  
**Priority:** 🟡 Medium  
**Effort:** Medium  

**Problem:**  
System prompts are static strings that cannot adapt to current project state.

**Solution:**  
Decompose each agent's system prompt into composable `ContextProvider` objects. At runtime, providers are called and their outputs concatenated.

```typescript
interface ContextProvider {
  name: string;
  priority: number;       // higher = inserted first
  maxTokens: number;      // budget allocation
  provide(ctx: RunContext): Promise<string>;
}

// Built-in providers:
const GitStateProvider: ContextProvider = { ... };      // current branch, recent commits
const ProjectConventionsProvider: ContextProvider = { ... }; // from shared_instructions.md
const TaskHistoryProvider: ContextProvider = { ... };   // recent relevant runs from episodic memory
const UserPreferencesProvider: ContextProvider = { ... }; // from session context
```

**Frontmatter Addition:**
```yaml
capability:
  context_providers:
    - git-state
    - project-conventions
    - task-history
    - user-preferences
```

---

#### IMP-038: Per-Run Model Tier Selection

**Source:** Pydantic AI `model_settings` + ruflo's existing 3-tier routing  
**Priority:** 🟡 Medium  
**Effort:** Low  

**Problem:**  
All agents run with the same model tier regardless of task complexity.

**Solution:**  
Allow the orchestrator to inject `model_settings` per task at dispatch time. Extend the existing 3-tier routing (ADR-026) to apply to all 230+ agents.

**Frontmatter Addition:**
```yaml
capability:
  model_preference:
    default: sonnet        # 'haiku' | 'sonnet' | 'opus'
    max_cost_usd: 0.05     # auto-downgrade to haiku if exceeded
    extended_thinking: false
```

**Orchestrator Logic:**
```
simple task (score < 30%) AND agent.model_preference.default != 'opus'
  → override to haiku, max_tokens: 2048

complex task (score > 70%) OR agent.capability.task_types includes 'architecture'
  → use opus, extended_thinking: true

default → sonnet
```

---

### Tier 9 — Agent Composition & Synthesis

---

#### IMP-039: ManagedAgent — Any Agent as a Callable Tool

**Source:** smolagents `ManagedAgent`  
**Priority:** 🟠 High  
**Effort:** Low  

**Problem:**  
No clean way for a top-level agent to call a sub-agent and receive its result as a simple value. Current patterns require manual prompt engineering.

**Solution:**  
Wrap any sub-agent in a `ManagedAgent` adapter exposing `run(task: str) -> str`. The orchestrator treats it identically to any other MCP tool call.

```typescript
// v3/@claude-flow/cli/src/agents/managed-agent.ts

class ManagedAgent {
  constructor(private agentSlug: string) {}
  
  // Exposed as an MCP tool to the orchestrator
  async run(task: string): Promise<string> {
    const result = await spawnAndAwait(this.agentSlug, task);
    return result.output;
  }
  
  // Tool schema inferred from signature
  static toMCPTool(agentSlug: string): MCPTool {
    return {
      name: `agent_${agentSlug.replace(/-/g, '_')}`,
      description: `Delegate task to ${agentSlug} specialist agent`,
      inputSchema: { type: 'object', properties: { task: { type: 'string' } } },
    };
  }
}
```

---

#### IMP-040: Dynamic Agent Synthesis (AutoBuild)

**Source:** AutoGen AutoBuild  
**Priority:** 🟢 Future  
**Effort:** High  

**Problem:**  
Even with 230+ agents, novel task types may require capability combinations that don't exist. There is no mechanism to create agents on demand.

**Solution:**  
A `SynthesisWorker` background worker triggers when no agent scores above the HNSW similarity threshold. It uses an LLM to generate a new agent's system prompt, tools list, and capability metadata. The synthesized agent is written to `.claude/agents/ephemeral/` with a TTL.

```typescript
// v3/@claude-flow/hooks/src/workers/synthesis.ts

class SynthesisWorker extends BackgroundWorker {
  async synthesize(taskDescription: string): Promise<AgentDefinition> {
    const existingAgents = await agentRegistry.getAll();
    const prompt = buildSynthesisPrompt(taskDescription, existingAgents);
    const definition = await claudeSonnet(prompt, { response_model: AgentDefinition });
    
    // Write to ephemeral dir with TTL
    await writeAgentFile(`.claude/agents/ephemeral/${definition.slug}.md`, definition);
    await agentRegistry.register(definition, { ttl: '24h' });
    
    return definition;
  }
}
```

---

#### IMP-041: MicroAgent Trigger Patterns

**Source:** OpenHands MicroAgent  
**Priority:** 🟡 Medium  
**Effort:** Low  

**Problem:**  
General-purpose agents waste context window on tasks requiring narrow expertise. Manual routing misses implicit specialty signals in task descriptions.

**Solution:**  
A `triggers` field in agent frontmatter. The orchestrator scans task descriptions for trigger patterns and injects matching microagents as co-participants.

**Frontmatter Addition:**
```yaml
capability:
  triggers:
    - pattern: "\\b(auth|jwt|session|oauth|saml)\\b"
      mode: "inject"   # 'inject' = add as co-participant; 'takeover' = own the task
    - pattern: "CVE-\\d{4}-\\d+"
      mode: "inject"
```

**Microagent Examples:**
- `security-audit-microagent`: triggers on `auth`, `jwt`, `sql`, `injection`
- `git-microagent`: triggers on `git blame`, `commit`, `merge conflict`
- `dockerfile-microagent`: triggers on `Dockerfile`, `docker-compose`, `container`

---

#### IMP-042: Nested Swarm Sub-Conversations

**Source:** AutoGen nested chats  
**Priority:** 🟡 Medium  
**Effort:** Medium  

**Problem:**  
Hierarchical swarms propagate tasks in a linear chain. There is no clean encapsulation of sub-swarm work — the parent sees the raw transcript.

**Solution:**  
When a top-level orchestrator delegates to a sub-swarm, wrap it in a nested-chat envelope. The parent receives only the summary, not the raw transcript. HNSW indexes the nested transcript separately.

---

### Tier 10 — Testing & CI

---

#### IMP-043: TestModel for Deterministic Agent Unit Testing

**Source:** Pydantic AI `TestModel`  
**Priority:** 🟠 High  
**Effort:** Medium  

**Problem:**  
Testing agent orchestration logic requires calling the real Claude API, making tests slow, expensive, and non-deterministic.

**Solution:**  
A `TestModel` that replays fixed responses from a `{prompt_hash → response}` map. Entire agent orchestration logic (routing, retry, handoff sequencing) is testable offline at millisecond speed.

```typescript
// v3/@claude-flow/testing/src/test-model.ts

interface TestModelConfig {
  responses: Map<string, string>;  // prompt_hash → response text
  defaultResponse?: string;        // fallback for unmatched prompts
  recordMode?: boolean;            // record real API calls to build the map
}

class TestModel {
  constructor(private config: TestModelConfig) {}
  
  async complete(prompt: string): Promise<string> {
    const hash = hashPrompt(prompt);
    const response = this.config.responses.get(hash) ?? this.config.defaultResponse;
    if (!response) throw new Error(`No test fixture for prompt hash: ${hash}`);
    return response;
  }
  
  static fromFixtureFile(path: string): TestModel { ... }
  static record(realModel: Model, fixturePath: string): TestModel { ... }
}
```

**Test Example:**
```typescript
// tests/agents/code-reviewer.test.ts
describe('CodeReviewer agent routing', () => {
  it('routes to security agent on auth-related code', async () => {
    const testModel = TestModel.fromFixtureFile('./fixtures/auth-review.json');
    const router = new RouteLayer({ model: testModel });
    
    const result = await router.route('Review the JWT validation in auth.ts');
    expect(result.agentSlug).toBe('engineering-security-engineer');
    expect(result.confidence).toBeGreaterThan(0.8);
  });
});
```

---

#### IMP-044: Automated Eval Dataset from Production Traces

**Source:** Langfuse dataset creation  
**Priority:** 🟡 Medium  
**Effort:** Medium  
**Depends on:** IMP-021, IMP-022  

**Problem:**  
Evaluation datasets are manually curated and quickly go stale relative to real production task distribution.

**Solution:**  
Automatically flag traces where `retry_count > 1` or quality score < threshold into a `needs_review` dataset. Human reviewers add corrected outputs. Dataset feeds both DSPy optimizer runs (IMP-036) and regression test suites.

```bash
npx claude-flow@v3alpha eval dataset create --from-traces --min-retries 2 --period 30d
npx claude-flow@v3alpha eval dataset review   # interactive review UI
npx claude-flow@v3alpha eval run --dataset production-failures --agents all
```

---

#### IMP-045: Agent Regression Test Suite

**Source:** Crew AI + research systems agent benchmarks  
**Priority:** 🟡 Medium  
**Effort:** Medium  
**Depends on:** IMP-043, IMP-044  

**Problem:**  
No automated verification that agent changes don't regress performance. Blind refactoring risk across 230+ agents.

**Solution:**  
A benchmark suite per agent category. Each benchmark has: input task, expected output schema, quality metric, baseline score. CI fails if any agent regresses > 5%.

```
tests/
  benchmarks/
    engineering/
      backend-architect.benchmark.json
      code-reviewer.benchmark.json
    security/
      security-engineer.benchmark.json
    marketing/
      seo-specialist.benchmark.json
```

---

### Tier 11 — Versioning & Registry

---

#### IMP-046: Agent Definition Versioning + Rollback

**Source:** OpenHands AgentHub + CrewAI production deployments  
**Priority:** 🟡 Medium  
**Effort:** Medium  

**Problem:**  
Agent definitions have no versioning. Breaking changes to prompts or tools can't be reverted without git archaeology.

**Solution:**  
Add semantic versioning to each agent definition. AgentDB stores version history. CLI supports rollback to any prior version.

**Frontmatter Addition:**
```yaml
---
name: Security Engineer
version: "2.1.0"
changelog: "Added CVE database lookup tool; improved OWASP coverage"
deprecated: false
---
```

**CLI Commands:**
```bash
npx claude-flow@v3alpha agent version list --slug engineering-security-engineer
npx claude-flow@v3alpha agent version rollback --slug engineering-security-engineer --to 2.0.0
npx claude-flow@v3alpha agent version diff --slug engineering-security-engineer --from 2.0.0 --to 2.1.0
```

---

#### IMP-047: Central Agent Registry API

**Source:** OpenHands AgentHub + npm-style registry  
**Priority:** 🟡 Medium  
**Effort:** Medium  
**Depends on:** IMP-046  

**Problem:**  
230+ agents in `.claude/agents/` have no central registry for discovery, versioning, namespace collision detection, or dependency tracking.

**Solution:**  
A `registry.json` at `.claude/agents/registry.json` tracking each agent's metadata. A `RegistryWorker` validates agent definitions on startup. A query API for agent discovery.

**Registry Schema:**
```typescript
interface AgentRegistryEntry {
  slug: string;
  version: string;
  category: string;
  capabilities: string[];
  taskTypes: string[];
  outputSchema?: string;
  tools: string[];
  deprecated: boolean;
  deprecatedBy?: string;  // replacement agent slug
  dependencies?: string[]; // other agents this one delegates to
  registeredAt: Date;
  lastUpdated: Date;
}
```

**Registry Query API:**
```bash
npx claude-flow@v3alpha registry find --capability "security-audit"
npx claude-flow@v3alpha registry find --task-type "architecture"
npx claude-flow@v3alpha registry validate       # check all definitions
npx claude-flow@v3alpha registry conflicts      # detect name/capability conflicts
```

---

#### IMP-048: Tool Versioning + Deprecation Warnings

**Source:** API versioning best practices  
**Priority:** 🟡 Medium  
**Effort:** Low  

**Problem:**  
40+ MCP tools have no versioning. Tool removals break agents silently.

**Solution:**  
Add `version` and `deprecated` metadata to MCP tool schemas. Agents that use deprecated tools receive a deprecation warning in their context.

**Files to Modify:**
- `v3/mcp/tools/agent-tools.ts` — add version metadata to all tool schemas
- `v3/mcp/tools/task-tools.ts`
- `v3/mcp/tools/memory-tools.ts`

---

## 4. Implementation Priorities

### Phase 1 — Foundation (implement first, unblocks everything else)

| # | Improvement | Why First |
|---|---|---|
| IMP-001–003 | Semantic RouteLayer | Unblocks all agent routing improvements |
| IMP-011–012 | Typed I/O Contracts + Auto-retry | Unblocks safe inter-agent communication |
| IMP-021 | Per-agent cost tracking | Unblocks observability, prompt optimization |
| IMP-031 | Graph checkpointing | Unblocks safe long-running swarms |
| IMP-004 | Structured capability metadata | Unblocks HNSW re-indexing, better routing |

### Phase 2 — Memory & Observability

| # | Improvement | Why Second |
|---|---|---|
| IMP-006–008 | Multi-tier memory | Compounds agent knowledge |
| IMP-022–025 | Trace hierarchy + Observability Bus | Required for prompt optimization |
| IMP-027 | Human-in-the-loop checkpoints | Safety for autonomous operation |
| IMP-039 | ManagedAgent adapter | Clean agent composition |
| IMP-043 | TestModel for CI | Prevent regressions during Phase 1 changes |

### Phase 3 — Optimization & Workflows

| # | Improvement | Why Third |
|---|---|---|
| IMP-015–017 | Task DAG + Workflow DSL | Enables complex pipelines |
| IMP-036–038 | Prompt optimization + dynamic assembly | Continuous improvement loop |
| IMP-020 | Team routing modes | Explicit orchestration semantics |
| IMP-013 | Shared instructions | Convention propagation at scale |
| IMP-026 | Prompt versioning | A/B testing capability |

### Phase 4 — Ecosystem Maturity

| # | Improvement | Why Fourth |
|---|---|---|
| IMP-046–048 | Agent + tool versioning/registry | Scalable agent ecosystem management |
| IMP-041 | MicroAgent triggers | Specialist injection without manual routing |
| IMP-044–045 | Eval datasets + regression benchmarks | Production quality assurance |
| IMP-029 | Termination conditions | Runaway loop prevention |
| IMP-035 | Consensus audit log | Distributed system auditability |

### Phase 5 — Advanced (longer horizon)

| # | Improvement | Why Later |
|---|---|---|
| IMP-010 | Procedural memory (skill learning) | High complexity, requires Phase 1–3 infra |
| IMP-034 | Per-agent sandboxing | Infrastructure dependency (Docker) |
| IMP-040 | Dynamic agent synthesis (AutoBuild) | Requires eval infra to validate synthesized agents |
| IMP-016–019 | Full TypedDict state + SubGraphs | High effort, requires workflow DSL first |

---

## 5. File & Directory Impact Map

### New Files/Directories

```
v3/@claude-flow/routing/          ← IMP-001–005 (new package)
  src/
    route-layer.ts
    keyword-pre-filter.ts
    routes/
      *.route.ts                  ← one per agent category

v3/@claude-flow/memory/src/tiers/ ← IMP-006–009
  short-term.ts
  entity.ts
  contextual.ts
  tier-manager.ts

v3/@claude-flow/hooks/src/observability/ ← IMP-021–025
  bus.ts
  trace.ts
  cost-recorder.ts

v3/@claude-flow/cli/src/workflow/  ← IMP-015–017
  dsl-parser.ts
  executor.ts
  map-reduce-worker.ts

v3/@claude-flow/testing/src/       ← IMP-043
  test-model.ts
  fixture-builder.ts

.claude/agents/schemas/            ← IMP-011
  *.json                           ← JSON Schema per agent output type

.claude/agents/registry.json       ← IMP-047

.agents/shared_instructions.md    ← IMP-013

.claude/workflows/                 ← IMP-017
  *.yaml

docs/improvement_plan.md          ← THIS FILE
```

### Modified Files

```
v3/mcp/tools/agent-tools.ts       ← IMP-001, IMP-015, IMP-020, IMP-027, IMP-029
v3/@claude-flow/memory/src/agent-db.ts ← IMP-006, IMP-031
v3/@claude-flow/hooks/src/workers/ ← IMP-007, IMP-009, IMP-036, IMP-040
.agents/skills/agent-coordination/SKILL.md ← IMP-001
.claude/agents/**/*.md            ← IMP-004, IMP-009, IMP-011, IMP-028, IMP-029, IMP-038, IMP-041, IMP-046
```

---

## 6. Cross-Improvement Dependencies

```
IMP-001 (RouteLayer)
  └── IMP-002 (LLM Fallback)
  └── IMP-003 (Keyword Pre-filter)
  └── IMP-005 (Specialization Scoring)
       └── IMP-013 cost tracking

IMP-004 (Capability Metadata)
  └── IMP-001 (RouteLayer uses it for embeddings)
  └── IMP-041 (MicroAgent triggers use it)

IMP-006 (Multi-tier Memory)
  └── IMP-007 (Entity Memory)
  └── IMP-008 (Episodic Memory)
  └── IMP-009 (Per-agent Knowledge Base)
  └── IMP-010 (Procedural Memory)

IMP-011 (Typed I/O)
  └── IMP-012 (Auto-retry)
  └── IMP-015 (Task DAG — context injection uses schemas)

IMP-021 (Cost Tracking)
  └── IMP-022 (Trace Hierarchy)
       └── IMP-023 (Latency Percentiles)
       └── IMP-024 (Session Replay)
       └── IMP-025 (Observability Bus)
  └── IMP-036 (Prompt Optimization — uses quality scores)
  └── IMP-044 (Eval Datasets — from traces)
       └── IMP-045 (Regression Benchmarks)

IMP-022 (Trace Hierarchy)
  └── IMP-025 (Observability Bus)
  └── IMP-026 (Prompt Versioning — tracks active version per trace)

IMP-031 (Checkpointing)
  └── IMP-027 (Human-in-the-loop — resumes from checkpoint)

IMP-036 (Prompt Optimization)
  └── IMP-026 (Prompt Versioning — writes new version)
       └── IMP-044 (Eval Datasets — tracks which version produced what)

IMP-043 (TestModel)
  └── IMP-044 (Eval Datasets)
       └── IMP-045 (Regression Benchmarks)
```

---

*End of Improvement Plan — 48 improvements across 11 tiers*  
*Total estimated new files: ~35 | Modified files: ~240 (mostly agent frontmatter)*
