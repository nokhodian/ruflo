# Ruflo System Architecture

Current-state map of all subsystems. Updated after each implementation phase.

---

## Core Subsystems

### 1. Agent Registry
- **Location:** `.claude/agents/` (230+ markdown files)
- **Format:** Frontmatter (`name`, `description`, `tools`, `model`) + body
- **MCP validation:** `v3/mcp/tools/agent-tools.ts` — `ALLOWED_AGENT_TYPES` const array
- **Routing:** `.agents/skills/agent-coordination/SKILL.md`
- **Status:** Complete. Fixed in session: 20 marketing agents (Edit tool), 4 architect agents (no Bash), lsp-index-engineer (WebSearch/WebFetch), zk-steward (description), 3 missing slugs added

### 2. Routing Layer
- **Location:** `v3/@claude-flow/routing/`
- **Status:** Task 01 — IMPLEMENTED
- **What it does:** Cosine-similarity routing from task description → agent slug
- **Key exports:** `RouteLayer`, `ALL_ROUTES`, `cosineSimilarity`, `LocalEncoder`
- **Route files:** 9 files covering 40+ routes (core, security, engineering, testing, design, marketing, product, specialized, game-dev)
- **CLI:** `claude-flow route semantic -t "..."` → `RouteResult`
- **Auto-routing:** `agent spawn --task "..."` (no `--type` needed)
- **Pending:** Task 02 (LLM fallback), Task 03 (keyword pre-filter), Task 04 (capability metadata)

### 3. CLI (26 Commands)
- **Location:** `v3/@claude-flow/cli/src/commands/`
- **Key commands:** `agent`, `route`, `swarm`, `memory`, `hooks`, `neural`, `session`, `workflow`
- **Modified in T01:** `agent.ts` (auto-routing), `route.ts` (semantic subcommand)
- **Pending:** Tasks 02–04 add subcommands; Task 07 adds `cost report`; Task 08 adds `checkpoint`

### 4. Memory System
- **Location:** `v3/@claude-flow/memory/`
- **Current:** AgentDB (SQLite via sql.js) + HNSW vector index
- **Pending additions:**
  - Task 09: Multi-tier (short-term / long-term / contextual) with `TierManager`
  - Task 10: Entity memory (`EntityStore` + auto-extraction worker)
  - Task 11: Episodic memory (`EpisodicStore` — session-scoped episode recording)
  - Task 28: Agent knowledge base (per-agent namespaced memory)
  - Task 45: Procedural memory (action sequences)

### 5. Hooks System (17 Hooks + 12 Workers)
- **Location:** `v3/@claude-flow/hooks/src/`
- **Hooks:** pre/post-edit, pre/post-command, pre/post-task, session-start/end/restore, route, explain, pretrain, build-agents, transfer, intelligence, worker, teammate-idle, task-completed
- **Workers:** ultralearn, optimize, consolidate, predict, audit, map, preload, deepdive, document, refactor, benchmark, testgaps
- **Pending additions:**
  - Task 08: `CheckpointWorker` (worker #13)
  - Task 12: Trace hierarchy (span/generation events on all hooks)
  - Task 15: ObservabilityBus (unified typed event bus)
  - Task 16: Human-in-the-loop interrupt gates

### 6. MCP Tools (40+)
- **Location:** `v3/mcp/tools/`
- **Key file:** `agent-tools.ts` — defines `ALLOWED_AGENT_TYPES`, `spawnAgentSchema`
- **Pending:** Task 32 adds `trigger:` field to agent frontmatter (microagent triggers)

### 7. Observability
- **Current:** Basic hook logging
- **Pending:**
  - Task 12: Trace hierarchy (Trace → Span → Generation typed events)
  - Task 13: Latency percentiles (p50/p95/p99 per agent/hook)
  - Task 14: Session replay (full event stream reconstruction)
  - Task 15: ObservabilityBus (multiplexes all hooks into unified stream)

### 8. Swarm Coordination
- **Current:** MCP swarm_init + Task tool agents, hierarchical topology, raft consensus
- **Pending:**
  - Task 08: Graph checkpointing (resume from any state)
  - Task 16: Human-in-the-loop (interrupt + approval gates)
  - Task 19: Task DAG (dependency-aware topological execution)
  - Task 20: Typed swarm state (shared `SwarmState<T>` with validation)
  - Task 21: Workflow DSL (YAML declarative workflows)
  - Task 44: Nested swarms (sub-swarm spawning)

### 9. Quality & Testing
- **Current:** Basic unit tests
- **Pending:**
  - Task 05: Typed I/O contracts (JSON Schema validation between agents)
  - Task 06: Auto-retry on validation errors
  - Task 18: TestModel (deterministic offline testing)
  - Task 33: Eval datasets (golden-answer sets per agent)
  - Task 34: Regression benchmarks (CI accuracy gates)

### 10. Cost & Performance
- **Pending:**
  - Task 07: Per-agent cost tracking (`agent_cost_records` SQLite table + `cost report` CLI)
  - Task 13: Latency percentiles
  - Task 27: Per-run model tier selection (Haiku/Sonnet/Opus per task complexity)
  - Task 39: Specialization scoring (track which agents perform best at which tasks)

---

## Data Flow (Current)

```
User Task Description
        │
        ▼
  RouteLayer.route()          ← Task 01 (DONE)
  (cosine similarity)
        │
        ├─ confidence >= threshold → agentSlug
        └─ confidence < threshold  → llm_fallback (Task 02 handles)
                │
                ▼
         agent spawn --type <slug>
                │
                ▼
         MCP agent/spawn
         (ALLOWED_AGENT_TYPES check)
                │
                ▼
         Claude Code Task tool
         (actual agent execution)
```

## Data Flow (Target — after all 48 tasks)

```
User Task Description
        │
        ▼
  KeywordPreFilter             ← Task 03
        │
        ├─ keyword match → fast route
        └─ no match ↓
  RouteLayer (cosine)          ← Task 01 (DONE)
        │
        ├─ confident → agentSlug
        └─ uncertain → LLMFallbackRouter ← Task 02
                │
                ▼
  AgentContract validation     ← Task 05
  (typed I/O schema check)
                │
                ▼
  Model tier selection         ← Task 27
  (Haiku/Sonnet/Opus)
                │
                ▼
  runAgentWithRetry()          ← Task 06
        │
        ├─ success → CostTracker.record()  ← Task 07
        │            ObservabilityBus      ← Task 15
        │            CheckpointWorker      ← Task 08
        └─ fail    → DeadLetterQueue       ← Task 37
```

---

## Task Dependency Graph (Simplified)

```
01-routing ──┬── 02-llm-fallback
             └── 03-keyword-filter
                      │
04-capability-metadata┘ (feeds 02, 03)

05-typed-io ──── 06-auto-retry

07-cost-tracking    (standalone)
08-graph-checkpoint (standalone)

09-multi-tier-mem ──── 10-entity-mem ──── 11-episodic-mem

12-trace-hierarchy ──── 15-observability-bus ──── 14-session-replay
                 └───── 13-latency-percentiles

16-human-in-loop    (standalone)
17-managed-agent    (standalone)
18-test-model       (standalone)

19-task-dag ──── 21-workflow-dsl
20-typed-swarm-state

25-bootstrap-fewshot ──── 26-dynamic-prompt-assembly
24-prompt-versioning

30-agent-registry ──── 29-agent-versioning
                  └──── 31-tool-versioning

33-eval-datasets ──── 34-regression-benchmarks
```
