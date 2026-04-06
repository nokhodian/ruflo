# Ruflo Implementation Task Queue

> Last updated: 2026-04-06  
> Source: `docs/improvement_plan.md` — 48 improvements across 11 tiers  
> Queue structure: 5 phases, sequenced by dependency order

---

## How to Use This Queue

**Before picking up a task:**

1. Read this file top to bottom — understand the phase and dependency graph first.
2. Scan the Task Index table to find tasks whose `Status` column shows `PENDING` and whose `Depends On` column lists only tasks marked `DONE`.
3. Read the individual task file (e.g., `01-semantic-route-layer.md`) in full.
4. Follow the protocol in `00-AGENT-PROTOCOL.md` exactly — it is the implementation contract.

**Picking up a task:**

- Open the task file and add a `## Status` section at the bottom:
  ```
  ## Status
  - **Picked up:** 2026-04-06
  - **Agent:** <your agent identifier>
  - **State:** IN_PROGRESS
  ```
- Do not pick up a task if any of its dependencies are not `DONE`.

**Marking a task done:**

- Update the `## Status` section:
  ```
  ## Status
  - **Picked up:** 2026-04-06
  - **Agent:** <your agent identifier>
  - **Completed:** 2026-04-06
  - **State:** DONE
  - **Outcome:** <brief description of what was implemented and any deviations>
  - **Tests:** <test file paths that cover this task>
  - **Commit:** <git commit hash>
  ```

**Handling blockers:**

- If a dependency is not yet done, do not start the task. Pick a different task in the same phase that has no pending dependencies.
- If you encounter an unexpected blocker mid-implementation, update `State` to `BLOCKED`, describe the blocker in `Outcome`, and move to a different task.

**Parallel work:**

- Tasks within the same phase that have no shared dependencies can be worked in parallel by different agents.
- Tasks from different phases must not be started until all their declared dependencies are `DONE`.

---

## Dependency Graph

```
PHASE 1 — Foundation
─────────────────────────────────────────────────────────────────
IMP-004  Structured Capability Metadata
    └─► IMP-001  Semantic RouteLayer  ◄─────────────────────────┐
            └─► IMP-002  LLM Fallback Routing                   │
            └─► IMP-003  Hybrid Keyword + Semantic Routing       │
            └─► IMP-005  Agent Specialization Scoring ────────── │
                              (also depends on IMP-021)          │
IMP-011  Typed Agent I/O Contracts                              │
    └─► IMP-012  Structured Output Auto-Retry                   │
IMP-021  Per-Agent Cost + Token Tracking                        │
IMP-031  Full Graph Checkpointing + Resume ──────────┐          │
                                                     │          │

PHASE 2 — Memory & Observability
─────────────────────────────────────────────────────────────────
IMP-006  Multi-Tier Memory Architecture
    └─► IMP-007  Entity Memory (Knowledge Graph)
    └─► IMP-008  Episodic Memory + Temporal Binning
    └─► IMP-009  Per-Agent Knowledge Base

IMP-022  Distributed Trace Hierarchy  ◄── (requires IMP-021)
    └─► IMP-023  Latency Percentile Monitoring
    └─► IMP-024  Session Replay
    └─► IMP-025  Unified Observability Bus
    └─► IMP-026  Prompt Version Management

IMP-027  Human-in-the-Loop Approval Gates ◄── (requires IMP-031)
IMP-039  ManagedAgent Adapter
IMP-043  TestModel for Deterministic CI

PHASE 3 — Optimization & Workflows
─────────────────────────────────────────────────────────────────
IMP-015  Task Context Dependency Graph (DAG)  ◄── (requires IMP-011)
    └─► IMP-017  Declarative Workflow DSL
            └─► IMP-018  SubGraph Composition
IMP-016  TypedDict Swarm State + Reducers    ◄── (requires IMP-017)
IMP-036  Prompt Optimization (BootstrapFewShot) ◄── (requires IMP-021, IMP-026)
IMP-037  Dynamic System Prompt Assembly
IMP-038  Per-Run Model Tier Selection
IMP-013  Shared Agency Instructions
IMP-020  Three-Mode Team Routing
IMP-026  Prompt Version Management (if not done in Phase 2)

PHASE 4 — Ecosystem Maturity
─────────────────────────────────────────────────────────────────
IMP-046  Agent Definition Versioning + Rollback
    └─► IMP-047  Central Agent Registry API
IMP-048  Tool Versioning + Deprecation Warnings
IMP-041  MicroAgent Trigger Patterns       ◄── (requires IMP-004)
IMP-044  Automated Eval Dataset            ◄── (requires IMP-021, IMP-022)
    └─► IMP-045  Agent Regression Test Suite  ◄── (requires IMP-043)
IMP-029  Per-Agent Termination Conditions
IMP-035  Consensus Proof + Voting Audit Log

PHASE 5 — Advanced (longer horizon)
─────────────────────────────────────────────────────────────────
IMP-010  Procedural Memory (Skill Learning) ◄── (requires IMP-006)
IMP-034  Per-Agent Runtime Sandboxing
IMP-040  Dynamic Agent Synthesis (AutoBuild) ◄── (requires IMP-044, IMP-045)
IMP-019  Isolated Thread per Agent Pair    ◄── (requires IMP-017)
IMP-028  Mandatory Planning Step
IMP-030  Confidence-Gated Human Input      ◄── (requires IMP-027)
IMP-032  Dead Letter Queue + Message Forensics
IMP-033  Tool Failure Retry + Exponential Backoff
IMP-042  Nested Swarm Sub-Conversations
IMP-014  Communication Flows as Explicit Graph Edges
```

---

## Task Index

| Task # | ID | Title | Phase | Priority | Effort | Depends On | Blocks | Status |
|--------|----|-------|-------|----------|--------|------------|--------|--------|
| 01 | IMP-004 | Structured Agent Capability Metadata | 1 | High | Low | — | IMP-001, IMP-041 | PENDING |
| 02 | IMP-001 | Semantic RouteLayer | 1 | Critical | Med | IMP-004 | IMP-002, IMP-003, IMP-005 | PENDING |
| 03 | IMP-002 | LLM Fallback Routing | 1 | High | Low | IMP-001 | — | PENDING |
| 04 | IMP-003 | Hybrid Keyword + Semantic Routing | 1 | High | Low | IMP-001 | — | PENDING |
| 05 | IMP-011 | Typed Agent I/O Contracts | 1 | Critical | Med | — | IMP-012, IMP-015 | PENDING |
| 06 | IMP-012 | Structured Output Auto-Retry | 1 | Critical | Low | IMP-011 | — | PENDING |
| 07 | IMP-021 | Per-Agent Cost + Token Tracking | 1 | Critical | Low | — | IMP-022, IMP-005, IMP-036, IMP-044 | PENDING |
| 08 | IMP-031 | Full Graph Checkpointing + Resume | 1 | High | Med | — | IMP-027 | PENDING |
| 09 | IMP-006 | Multi-Tier Memory Architecture | 2 | Critical | Med | — | IMP-007, IMP-008, IMP-009, IMP-010 | PENDING |
| 10 | IMP-007 | Entity Memory (Knowledge Graph) | 2 | High | Med | IMP-006 | — | PENDING |
| 11 | IMP-008 | Episodic Memory + Temporal Binning | 2 | High | Med | IMP-006 | — | PENDING |
| 12 | IMP-009 | Per-Agent Knowledge Base | 2 | Medium | Med | IMP-006 | — | PENDING |
| 13 | IMP-022 | Distributed Trace Hierarchy | 2 | High | Med | IMP-021 | IMP-023, IMP-024, IMP-025, IMP-026 | PENDING |
| 14 | IMP-023 | Latency Percentile Monitoring | 2 | Medium | Low | IMP-021, IMP-022 | — | PENDING |
| 15 | IMP-024 | Session Replay for Failure Diagnosis | 2 | Medium | Med | IMP-022 | — | PENDING |
| 16 | IMP-025 | Unified Observability Bus | 2 | High | Med | IMP-022 | — | PENDING |
| 17 | IMP-026 | Prompt Version Management | 2 | Medium | Low | IMP-022 | IMP-036 | PENDING |
| 18 | IMP-027 | Human-in-the-Loop Approval Gates | 2 | High | Med | IMP-031 | IMP-030 | PENDING |
| 19 | IMP-039 | ManagedAgent Adapter | 2 | High | Low | — | — | PENDING |
| 20 | IMP-043 | TestModel for Deterministic CI | 2 | High | Med | — | IMP-044, IMP-045 | PENDING |
| 21 | IMP-015 | Task Context Dependency Graph (DAG) | 3 | High | Med | IMP-011 | IMP-017 | PENDING |
| 22 | IMP-017 | Declarative Workflow DSL | 3 | High | High | IMP-015, IMP-016 | IMP-018, IMP-019 | PENDING |
| 23 | IMP-016 | TypedDict Swarm State + Reducers | 3 | High | Med | — | IMP-017 | PENDING |
| 24 | IMP-018 | SubGraph Composition | 3 | Medium | Med | IMP-017 | — | PENDING |
| 25 | IMP-036 | Prompt Optimization (BootstrapFewShot) | 3 | Medium | High | IMP-021, IMP-026 | — | PENDING |
| 26 | IMP-037 | Dynamic System Prompt Assembly | 3 | Medium | Med | — | — | PENDING |
| 27 | IMP-038 | Per-Run Model Tier Selection | 3 | Medium | Low | — | — | PENDING |
| 28 | IMP-013 | Shared Agency Instructions | 3 | Medium | Low | — | — | PENDING |
| 29 | IMP-020 | Three-Mode Team Routing | 3 | Medium | Low | — | — | PENDING |
| 30 | IMP-005 | Agent Specialization Scoring | 3 | Medium | Med | IMP-001, IMP-021 | — | PENDING |
| 31 | IMP-046 | Agent Definition Versioning + Rollback | 4 | Medium | Med | — | IMP-047 | PENDING |
| 32 | IMP-047 | Central Agent Registry API | 4 | Medium | Med | IMP-046 | — | PENDING |
| 33 | IMP-048 | Tool Versioning + Deprecation Warnings | 4 | Medium | Low | — | — | PENDING |
| 34 | IMP-041 | MicroAgent Trigger Patterns | 4 | Medium | Low | IMP-004 | — | PENDING |
| 35 | IMP-044 | Automated Eval Dataset from Traces | 4 | Medium | Med | IMP-021, IMP-022 | IMP-045 | PENDING |
| 36 | IMP-045 | Agent Regression Test Suite | 4 | Medium | Med | IMP-043, IMP-044 | — | PENDING |
| 37 | IMP-029 | Per-Agent Termination Conditions | 4 | Medium | Low | — | — | PENDING |
| 38 | IMP-035 | Consensus Proof + Voting Audit Log | 4 | Medium | Med | — | — | PENDING |
| 39 | IMP-010 | Procedural Memory (Skill Learning) | 5 | Future | High | IMP-006 | — | PENDING |
| 40 | IMP-034 | Per-Agent Runtime Sandboxing | 5 | Future | High | — | — | PENDING |
| 41 | IMP-040 | Dynamic Agent Synthesis (AutoBuild) | 5 | Future | High | IMP-044, IMP-045 | — | PENDING |
| 42 | IMP-019 | Isolated Thread per Agent Pair | 5 | Medium | Med | IMP-017 | — | PENDING |
| 43 | IMP-028 | Mandatory Planning Step | 5 | Medium | Low | — | — | PENDING |
| 44 | IMP-030 | Confidence-Gated Human Input | 5 | Medium | Low | IMP-027 | — | PENDING |
| 45 | IMP-032 | Dead Letter Queue + Message Forensics | 5 | High | Low | — | — | PENDING |
| 46 | IMP-033 | Tool Failure Retry + Exponential Backoff | 5 | High | Low | — | — | PENDING |
| 47 | IMP-042 | Nested Swarm Sub-Conversations | 5 | Medium | Med | — | — | PENDING |
| 48 | IMP-014 | Communication Flows as Explicit Graph Edges | 5 | Medium | Med | — | — | PENDING |

---

## Phase Overview

### Phase 1 — Foundation
**Goal:** Lay the infrastructure all other improvements depend on.

- **Routing:** Replace hardcoded route codes 1–13 with an embedding-based `RouteLayer` that matches task descriptions to agent capabilities at runtime. Requires structured capability metadata on every agent definition first.
- **Typed I/O:** Introduce JSON Schema contracts for inter-agent messages and an auto-retry loop that re-prompts agents when output fails schema validation.
- **Cost Tracking:** Instrument every Claude API call with per-agent token and cost attribution. Everything in later phases that involves optimization, eval, or observability reads from this data.
- **Checkpointing:** Persist full swarm state to AgentDB at each topology step so crashes are recoverable. Human-in-the-loop gates (Phase 2) require this.

Nothing in Phase 2 or later should be started until Phase 1 is fully `DONE`.

### Phase 2 — Memory & Observability
**Goal:** Give agents persistent multi-tier memory and a complete execution trace.

- **Memory:** Layer short-term (in-run buffer), long-term (HNSW), entity (SQLite KV), and contextual (compressed summaries) memory tiers over AgentDB.
- **Observability:** Emit every hook event into a unified `ObservabilityBus` with a `Trace → Span → Generation` hierarchy. Enable session replay, latency percentile reporting, and prompt version tracking.
- **Safety:** Add human interrupt gates before high-risk agents. Add `TestModel` for offline CI testing.

### Phase 3 — Optimization & Workflows
**Goal:** Enable complex multi-step pipelines and continuous prompt improvement.

- **Workflows:** Build a declarative DSL (YAML/JSON) for fan-out/fan-in, conditional branching, and loop patterns. Backed by a DAG executor that injects upstream task outputs automatically.
- **Prompt quality:** Dynamic context providers assemble system prompts at runtime from git state, shared instructions, and episodic memory. A `BootstrapFewShot` optimizer runs weekly against high-quality traces.
- **Orchestration modes:** Add explicit `route / coordinate / collaborate` modes to agent dispatch.

### Phase 4 — Ecosystem Maturity
**Goal:** Make 230+ agents manageable as a versioned, discoverable ecosystem.

- **Registry:** Every agent gets a semantic version and an entry in a central `registry.json`. CLI commands for discovery, conflict detection, and rollback.
- **MicroAgents:** Trigger-pattern injection of narrow specialists without explicit routing.
- **Eval pipeline:** Automated dataset construction from production traces; regression benchmarks that fail CI on >5% quality drop.

### Phase 5 — Advanced (longer horizon)
**Goal:** Capabilities that require the full Phase 1–4 infrastructure to be correct.

- Procedural memory (agents learn new skill procedures from executions).
- Per-agent Docker/WASM sandboxing.
- Dynamic agent synthesis (AutoBuild) when no existing agent matches.
- Isolated per-pair conversation threads, nested sub-swarms, dead letter queues.

---

## Agent Instructions

Follow these steps for every task, without skipping any:

### 1. Read the task file completely
Open the numbered task file (e.g., `02-semantic-route-layer.md`). Read every section before writing a single line of code. Pay special attention to:
- **Acceptance Criteria** — this is the definition of done.
- **Files to Create / Files to Modify** — these are the exact touch points.
- **Implementation Details** — typed interfaces and code samples are normative, not illustrative.

### 2. Analyze the current ruflo state
Before touching code, verify the current state of every file listed in "Files to Create" and "Files to Modify". Use `Read` to open each file. Use `Grep` to search for existing implementations that might conflict. Do not assume anything — confirm it.

### 3. Implement changes
- Follow Domain-Driven Design: one bounded context per package.
- Keep every file under 500 lines.
- TypeScript strict mode throughout — no `any` types.
- Named imports only from internal modules.
- All public APIs have typed interfaces.
- Input validation at every system boundary.
- Use event sourcing for state changes.

### 4. Write and run tests
- New modules get unit tests in `tests/` mirroring the `v3/` source path.
- Use Jest with `describe / it` blocks (not top-level `test()`).
- For routing logic: test the happy path, the fallback path, and a low-confidence case.
- For memory: test write, read, and expiry behavior.
- For observability: test that the correct event type is emitted.
- Run `npx tsc --noEmit` and the test suite before marking a task done. Both must pass.

### 5. Mark the task complete
Update the `## Status` section in the task file with completion date, test file paths, and commit hash.

### 6. Hand off to the next task
Check the Task Index for tasks that were blocked on the task you just completed. If their other dependencies are also `DONE`, they are now unblocked. Note this in your completion `Outcome` field.

---

## File Conventions

### Repository Layout

```
ruflo/                          ← monorepo root
  v3/                           ← all v3 source packages
    @claude-flow/
      cli/src/                  ← CLI commands and workflow logic
      memory/src/               ← AgentDB, HNSW, memory tiers
      hooks/src/                ← 17 hooks + 12 background workers
      routing/src/              ← NEW: RouteLayer (IMP-001–005)
      security/src/             ← Input validation, CVE remediation
      shared/src/               ← Shared types, schema validators
      testing/src/              ← NEW: TestModel, fixture builder (IMP-043)
    mcp/tools/                  ← MCP tool schemas and handlers
  .claude/agents/               ← 230+ agent definition markdown files
    schemas/                    ← NEW: JSON Schema per agent output type
    registry.json               ← NEW: Central agent registry
    workflows/                  ← NEW: Workflow YAML files
  .agents/
    skills/                     ← Static YAML skill definitions
    shared_instructions.md      ← NEW: Project-wide behavioral contracts
  tests/                        ← All test files (mirror v3/ structure)
  docs/
    improvement_plan.md         ← Source of truth for all improvements
    tasks/                      ← THIS directory: task queue
  scripts/                      ← Utility scripts
  config/                       ← Configuration files
  tsconfig.json                 ← TypeScript strict mode root config
  package.json                  ← pnpm workspace root
```

### Key Constraints

| Constraint | Rule |
|-----------|------|
| Package manager | pnpm workspaces |
| TypeScript | strict mode (`"strict": true`), no `any` |
| Files | Max 500 lines per file |
| Test framework | Jest, `describe/it` pattern |
| Test location | `tests/` — mirrors `v3/` source path |
| Imports | Named imports only from internal modules |
| State changes | Event sourcing pattern |
| API boundaries | Input validation required |
| Agent definitions | Markdown with YAML frontmatter |
| New packages | Created under `v3/@claude-flow/<name>/src/` |
| Never save to root | Use `src/`, `tests/`, `docs/`, `config/`, `scripts/` |

### TypeScript Compilation

Check always with:
```bash
npx tsc --noEmit
```

If the project uses per-package tsconfigs, compile the affected package:
```bash
npx tsc --noEmit -p v3/@claude-flow/<package>/tsconfig.json
```

### Running Tests

```bash
# All tests
npx jest

# Single file
npx jest tests/routing/route-layer.test.ts

# Watch mode during development
npx jest --watch

# With coverage
npx jest --coverage
```
