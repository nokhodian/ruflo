# Quick Start — Implementing MonoBrain Tasks

Pick this up and be productive in 2 minutes.

---

## Where Things Are

```
docs/
├── QUICKSTART.md              ← you are here
├── HANDOFF.md                 ← full context (read if you're starting fresh)
├── ARCHITECTURE.md            ← system map (read before touching a subsystem)
├── improvement_plan.md        ← master reference for all 48 improvements
└── tasks/
    ├── COMPLETED.md           ← what's done (update after each task)
    ├── 00-README.md           ← task index + dependency graph
    ├── 00-AGENT-PROTOCOL.md   ← implementation contract
    ├── 00-rebrand-monobrain.md ← ⚠️ RUN FIRST
    └── 01–48.md               ← task specs
```

---

## ⚠️ FIRST TASK: Rebrand

**Before doing anything else**, run the rebrand task:

```bash
cat docs/tasks/00-rebrand-monobrain.md
```

This renames the entire codebase:
- `ruvnet` → `nokhodian`
- `claude-flow` / `ruflo` → `monobrain`
- `@claude-flow/` → `@monobrain/` (all 21 packages)
- `CLAUDE_FLOW_` → `MONOBRAIN_` (88 env vars)
- `.claude-flow/` → `.monobrain/` (293 dir references)

All subsequent tasks build on the renamed codebase. Skip this and every new file will use the wrong names.

---

## Step 1: Find Your Next Task

```bash
cat docs/tasks/COMPLETED.md   # see what's done
cat docs/tasks/00-README.md   # see full index + dependencies
```

Pick the lowest-numbered task that:
- Is NOT in COMPLETED.md
- Has all its `Depends on:` tasks already completed

**Current order:** 00-rebrand → 02 → 03 → 04 → 05 → 07 → 08 → 09

---

## Step 2: Read the Task Spec

```bash
cat docs/tasks/00-rebrand-monobrain.md   # first run
cat docs/tasks/02-llm-fallback-routing.md  # after rebrand done
```

Every spec has 8 sections:
1. Current State — what exists today
2. Gap Analysis — what's missing and why it matters
3. Files to Create — your deliverables
4. Files to Modify — existing files to change
5. Implementation Steps — do these in order
6. Key Code Templates — start from these, expand to production quality
7. Testing Strategy — write these tests
8. Definition of Done — every checkbox must be true before you're done

---

## Step 3: Implement

```bash
# Read existing files before touching them
cat v3/@monobrain/cli/src/commands/route.ts   # after rebrand
# (before rebrand: v3/@claude-flow/cli/...)

# Create new package if needed
mkdir -p v3/@monobrain/<package>/src

# Build to check TypeScript
cd v3/@monobrain/<package> && npm install && npm run build

# Run tests
npm test
```

---

## Step 4: Mark Done + Push

```bash
# Update COMPLETED.md — append your task to Done list
git add -A
git commit -m "impl: task NN — short description"
git push nokhodian main
```

---

## Key Facts to Remember

| Thing | Value |
|-------|-------|
| App name | **MonoBrain** |
| npm CLI | `npx monobrain@latest` |
| Task 00 | Rebrand — run first |
| Task 01 (routing) | Done — `v3/@claude-flow/routing/` (becomes `@monobrain/` after T00) |
| Push remote | `nokhodian` → `https://github.com/nokhodian/ruflo` |
| Max file size | 500 lines |
| No `any` types | in public APIs |
| Always read before edit | non-negotiable |
| Source code goes in | `v3/@monobrain/<pkg>/src/` (after rebrand) |
| Tests go in | `tests/` |
| Never save to | project root |

---

## Subsystem Entry Points

After rebrand, paths use `@monobrain/`. Before rebrand, use `@claude-flow/`.

| Subsystem | Main File (post-rebrand) | Tasks That Touch It |
|-----------|--------------------------|---------------------|
| Rebrand scripts | `scripts/rebrand.sh` | 00 |
| Routing | `v3/@monobrain/routing/src/route-layer.ts` | 02, 03, 04 |
| CLI commands | `v3/@monobrain/cli/src/commands/` | 02, 03, 07, 08, 21 |
| Memory | `v3/@monobrain/memory/src/` | 09, 10, 11, 28, 45 |
| Hooks | `v3/@monobrain/hooks/src/` | 08, 12, 15, 16, 32 |
| MCP tools | `v3/mcp/tools/agent-tools.ts` | 05, 08, 10, 11 |
| Agent files | `.claude/agents/` | 04, 17, 32, 39 |
