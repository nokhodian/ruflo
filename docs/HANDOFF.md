# MonoBrain Implementation Handoff

Single file that gives a fresh agent or human complete context to continue implementation without reading anything else first.

> **Rebrand status:** The codebase is currently still named `claude-flow`/`ruflo`/`ruvnet`.
> Task `00-rebrand-monobrain` must run first to rename everything to `monobrain`/`nokhodian`.

---

## What Is This Project

**MonoBrain v3.5** (currently still named Ruflo/claude-flow — rebrand pending) — an enterprise Claude Code plugin with:
- 230+ Claude Code agents in `.claude/agents/`
- 40+ MCP tools in `v3/mcp/tools/`
- 17 hooks + 12 background workers in `v3/@claude-flow/hooks/`
- AgentDB + HNSW vector memory in `v3/@claude-flow/memory/`
- pnpm monorepo under `v3/@claude-flow/`

---

## Current Implementation State

### Done
| # | Task | What Was Built | Files |
|---|------|----------------|-------|
| 01 | Semantic RouteLayer | Cosine-similarity agent routing, 40+ routes, 9 categories | `v3/@claude-flow/routing/` |

### Pending (Tasks 00, 02–48)
See `docs/tasks/COMPLETED.md` for live status updated after each implementation run.

The next tasks in priority order:
1. **00** — **Rebrand to MonoBrain** ← RUN FIRST (ruvnet→nokhodian, claude-flow/ruflo→monobrain)
2. **02** — LLM Fallback Routing (depends on 01 ✅)
3. **03** — Keyword Pre-Filter Routing (depends on 01 ✅)
4. **04** — Capability Metadata (no deps)
5. **05** — Typed I/O Contracts (no deps)
6. **07** — Per-Agent Cost Tracking (no deps)
7. **08** — Graph Checkpointing (no deps)
8. **09** — Multi-Tier Memory (no deps)

---

## How to Implement a Task

Each task in `docs/tasks/NN-<name>.md` is self-contained. The protocol:

```
1. Read docs/tasks/COMPLETED.md        → see what's done
2. Read docs/tasks/NN-<name>.md        → full spec
3. Read all existing files it touches  → never edit without reading first
4. Implement Section 3 (create files)
5. Implement Section 4 (modify files)
6. Follow Section 5 (implementation steps)
7. Use Section 6 (code templates) as foundation
8. Write Section 7 tests, run them, fix errors
9. Verify every Section 8 DoD checkbox
10. Update docs/tasks/COMPLETED.md
11. git add -A && git commit && git push
```

Full protocol: `docs/tasks/00-AGENT-PROTOCOL.md`

---

## Key Files Reference

| File / Dir | Purpose |
|-----------|---------|
| `docs/tasks/COMPLETED.md` | Live progress tracker |
| `docs/tasks/00-README.md` | Full task index + dependency graph |
| `docs/tasks/00-AGENT-PROTOCOL.md` | Step-by-step implementation contract |
| `docs/tasks/01–48` | Task specs (each ~15–30KB, fully self-contained) |
| `docs/improvement_plan.md` | Master reference: all 48 improvements with context |
| `v3/@claude-flow/routing/` | Task 01 output — RouteLayer package |
| `v3/@claude-flow/cli/src/commands/` | CLI commands (agent.ts, route.ts modified in T01) |
| `v3/mcp/tools/agent-tools.ts` | ALLOWED_AGENT_TYPES + MCP spawn schema |
| `.claude/agents/` | 230+ agent `.md` files |
| `.agents/skills/agent-coordination/SKILL.md` | Agent routing skill (codes 1-13 deprecated) |
| `v3/@claude-flow/memory/src/` | AgentDB + HNSW — tasks 09–11 extend this |
| `v3/@claude-flow/hooks/src/` | Hooks system — tasks 12–16 extend this |

---

## Monorepo Structure

```
ruflo/
├── v3/
│   ├── @claude-flow/
│   │   ├── cli/          ← 26 CLI commands
│   │   ├── hooks/        ← 17 hooks + 12 workers
│   │   ├── memory/       ← AgentDB + HNSW
│   │   ├── routing/      ← NEW: SemanticRouteLayer (Task 01)
│   │   ├── security/     ← Input validation
│   │   └── shared/       ← Shared types
│   └── mcp/
│       └── tools/
│           └── agent-tools.ts  ← MCP tool definitions
├── .claude/
│   ├── agents/           ← 230+ agent markdown files
│   └── settings.json
├── .agents/
│   └── skills/           ← Skill definitions
├── docs/
│   ├── improvement_plan.md
│   ├── HANDOFF.md        ← this file
│   ├── ARCHITECTURE.md   ← system map
│   └── tasks/            ← 50-file implementation queue
└── tests/
    └── routing/          ← Task 01 tests
```

---

## Git Workflow

```bash
git remote -v
# origin   https://github.com/ruvnet/ruflo
# nokhodian https://github.com/nokhodian/ruflo  ← push here

git pull nokhodian main --rebase
# ... implement ...
git add -A
git commit -m "impl: tasks NN, NN — description"
git push nokhodian main
```

---

## Coding Rules (Always Apply)

- Files under 500 lines
- No TypeScript `any` in public APIs
- Read file before editing it
- Never save to root folder (`/`, `v3/`, etc.)
- Source → `v3/@claude-flow/<pkg>/src/`
- Tests → `tests/`
- Typed interfaces for all public APIs
- Input validation at system boundaries only
- No speculative abstractions — implement exactly what the task spec says

---

## Scheduled Automation

A remote Claude agent (CCR) is configured to run every hour and implement 3 tasks per run.

- Trigger ID: `trig_018DYx7ZY6TKohfTvfMkcG4D`
- Manage at: https://claude.ai/code/scheduled/trig_018DYx7ZY6TKohfTvfMkcG4D
- Currently: **disabled** (enable to resume automation)
- Tracks progress via: `docs/tasks/COMPLETED.md`
