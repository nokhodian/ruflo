# Agent Implementation Protocol

> This document is the implementation contract for any agent executing a task in the ruflo task queue.  
> Follow every step in order. Do not skip steps. Do not abbreviate steps.

---

## Pre-Implementation Checklist

Before writing a single line of code, complete every item on this list and confirm it in your working notes:

- [ ] **Read the task file in full.** Open the numbered task file. Read every section, including Acceptance Criteria, Implementation Details, Files to Create, and Files to Modify.
- [ ] **Read `docs/improvement_plan.md`** sections for the relevant IMP-XXX entry. The task file is a distillation; the improvement plan is the authoritative specification.
- [ ] **Read `CLAUDE.md` lines 1–80.** Refresh yourself on behavioral rules, file organization, and TypeScript constraints.
- [ ] **Check dependency status.** For every entry in the task's "Depends On" field, open that task file and confirm its `## Status` section says `DONE`. If any dependency is not `DONE`, stop — do not implement this task.
- [ ] **Verify the current state of all touch-point files.** For every file listed in "Files to Create" and "Files to Modify", run a `Read` or `Grep` to understand what already exists. Never overwrite or conflict with existing implementations without understanding them first.
- [ ] **Confirm TypeScript compiles cleanly before your changes.** Run `npx tsc --noEmit`. If there are pre-existing errors, note them but do not fix them as part of your task unless the task explicitly says to.
- [ ] **Mark the task IN_PROGRESS.** Add a `## Status` section to the task file (see format below) before beginning any code changes.

---

## Implementation Workflow

### Step 1 — Mark the task IN_PROGRESS

Add this section to the bottom of the task file immediately, before any code changes:

```markdown
## Status
- **Picked up:** YYYY-MM-DD
- **Agent:** <your agent identifier or session ID>
- **State:** IN_PROGRESS
```

This prevents another agent from picking up the same task concurrently.

### Step 2 — Read all touch-point files

For every file in "Files to Create" and "Files to Modify":

```
# For files that already exist:
Read the file completely.
Note: current exports, interfaces, imports, and any related logic.

# For files that do not exist yet:
Read the parent directory contents (ls) to understand co-located modules.
Read sibling files to understand naming and structure conventions.
```

Do this before writing anything. The improvement plan contains typed interfaces and code samples — cross-reference them against what actually exists in the codebase.

### Step 3 — Implement changes

**File creation rules:**
- Create files only in the locations specified by the task. Never create files in the root directory.
- New source files go under `v3/@claude-flow/<package>/src/` (or the path specified in the task).
- New test files go under `tests/` mirroring the source path.
- New agent definition schemas go under `.claude/agents/schemas/`.
- New workflow YAML files go under `.claude/workflows/`.

**TypeScript rules (enforced, non-negotiable):**
- `"strict": true` in tsconfig — no exceptions.
- No `any` types. Use `unknown` with type guards if the shape is truly dynamic.
- All public function parameters and return values must be explicitly typed.
- Named imports only from internal modules (no `import Foo from './foo'` for internal code).
- Maximum 500 lines per file. If a file approaches this limit, extract to a sibling module.

**Architecture rules:**
- Follow Domain-Driven Design with bounded contexts (one concern per package).
- Use event sourcing for state changes — emit typed events rather than mutating state directly.
- Validate all inputs at system boundaries. Throw typed errors with descriptive messages.
- Prefer composition over inheritance.
- Background workers extend the existing `BackgroundWorker` base class in `v3/@claude-flow/hooks/src/workers/`.
- New MCP tools follow the schema pattern in `v3/mcp/tools/agent-tools.ts`.

**Concurrency (mandatory pattern):**
- All independent file reads must be batched in one message (parallel `Read` calls).
- All independent file writes must be batched in one message (parallel `Write`/`Edit` calls).
- Never make sequential read-then-read calls when reads are independent.

### Step 4 — Write tests

Every task implementation requires tests. No exceptions. Tests live in `tests/` mirroring the source path:

```
v3/@claude-flow/routing/src/route-layer.ts
→ tests/routing/route-layer.test.ts

v3/@claude-flow/memory/src/tiers/entity.ts
→ tests/memory/tiers/entity.test.ts
```

**Test structure:**
```typescript
// tests/<path>/<module>.test.ts

import { describe, it, expect, beforeEach } from '@jest/globals';
import { MyModule } from '../../v3/@claude-flow/<package>/src/<module>';

describe('<ModuleName>', () => {
  describe('<method or behavior>', () => {
    it('should <expected behavior> when <condition>', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

**Minimum test coverage per task type:**

| Task Type | Required Tests |
|-----------|----------------|
| New routing logic | Happy path (match found), fallback path (no match), low-confidence path |
| New memory tier | Write succeeds, read returns written data, TTL/expiry behavior |
| New worker | Worker processes a valid payload, worker handles invalid payload gracefully |
| New CLI command | Command exits 0 on valid input, exits non-zero on invalid input |
| Schema validation | Valid input passes, invalid input returns typed error with field names |
| Observability | Correct event type is emitted with correct fields |
| Any retry logic | Succeeds on first attempt, succeeds after 1 retry, exhausts retries and degrades gracefully |

**For tasks involving the `TestModel` (IMP-043 or later):** Use `TestModel` instead of calling the real Claude API. Build a fixture file first:
```typescript
const testModel = TestModel.fromFixtureFile('./fixtures/<task>.json');
```

### Step 5 — Run TypeScript compilation

```bash
npx tsc --noEmit
```

**If using a per-package tsconfig:**
```bash
npx tsc --noEmit -p v3/@claude-flow/<package>/tsconfig.json
```

This must produce **zero errors** before proceeding. Fix any errors you introduced. Do not fix pre-existing errors unrelated to your task — note them in the Status section instead.

### Step 6 — Run the test suite

```bash
# Run all tests
npx jest

# Run only tests relevant to your task (faster feedback loop during development)
npx jest tests/<path>/<module>.test.ts

# Run with verbose output to see each test name
npx jest --verbose tests/<path>/
```

All tests must pass. If a pre-existing test was broken by your changes, you must fix the breakage. You may not mark a task `DONE` with failing tests.

### Step 7 — Commit

Use this commit message format exactly:

```
feat(<scope>): <short imperative description> [<IMP-XXX>]

<body: what changed and why, 2–4 sentences>
<mention any deviations from the task spec>

Implements: <IMP-XXX>
Depends-on: <IMP-XXX, IMP-XXX> (if applicable)
```

**Scope** is the package or area changed. Examples: `routing`, `memory`, `hooks`, `cli`, `testing`, `agents`.

**Examples:**

```
feat(routing): add semantic RouteLayer with cosine similarity matching [IMP-001]

Replaces hardcoded route codes 1–13 in SKILL.md with a RouteLayer that embeds
task descriptions at runtime and cosine-matches against per-agent utterance
centroids. Threshold-gated LLM fallback handles low-confidence matches.
Routing latency measured at <20ms with local encoder.

Implements: IMP-001
Depends-on: IMP-004
```

```
feat(memory): implement multi-tier memory architecture with TierManager [IMP-006]

Layers short-term (in-memory buffer), long-term (HNSW partition), entity
(SQLite KV), and contextual (compressed summaries) namespaces over AgentDB.
TierManager routes queries to the appropriate tier based on scope and TTL.

Implements: IMP-006
```

**Rules:**
- One commit per task (squash if you made intermediate commits during development).
- Never commit `.env` files, secrets, credentials, or API keys.
- Never commit to the root directory — all files must be in `src/`, `tests/`, `docs/`, `config/`, or `scripts/`.

### Step 8 — Mark the task DONE

Update the `## Status` section in the task file:

```markdown
## Status
- **Picked up:** YYYY-MM-DD
- **Agent:** <your agent identifier>
- **Completed:** YYYY-MM-DD
- **State:** DONE
- **Outcome:** <1–3 sentences: what was implemented, any deviations from spec, any known limitations>
- **Tests:** 
  - `tests/<path>/<module>.test.ts`
  - `tests/<path>/<other>.test.ts`
- **Commit:** <full git commit hash>
- **Unblocked tasks:** <IMP-XXX, IMP-XXX> — tasks that can now be started
```

---

## Testing Requirements

### Non-negotiable rules

1. Every new source file must have a corresponding test file.
2. Tests must use Jest with `describe/it` (not top-level `test()`).
3. `npx tsc --noEmit` must pass with zero errors from your changes.
4. `npx jest` must pass with zero failures from your changes.
5. Tests must be deterministic — no real Claude API calls in unit tests. Use `TestModel` (once IMP-043 is done) or mock the model interface.
6. Test fixtures go in `tests/fixtures/` with descriptive names tied to the scenario they represent.

### Mocking the Claude API (before IMP-043 is done)

Until `TestModel` is implemented, mock the model interface directly:

```typescript
import { jest } from '@jest/globals';

// Mock the module that makes Claude API calls
jest.mock('../../v3/@claude-flow/shared/src/model-client', () => ({
  claudeHaiku: jest.fn().mockResolvedValue('{"agentSlug":"engineering-security-engineer"}'),
  claudeSonnet: jest.fn().mockResolvedValue('mocked response'),
}));
```

### Integration tests vs. unit tests

- **Unit tests** (required for all tasks): Test each function/class in isolation with mocked dependencies.
- **Integration tests** (required for tasks that wire two or more packages together): Test the interaction with real instances of both sides, but still mock the Claude API and any external I/O.
- **Never** make real HTTP calls or real Claude API calls in any automated test.

---

## Completion Criteria

A task is `DONE` when all of the following are true:

| Criterion | How to verify |
|-----------|---------------|
| All acceptance criteria in the task file are met | Review each checkbox in the task file — each one must be `[x]` |
| TypeScript compiles with zero new errors | `npx tsc --noEmit` output |
| All tests pass | `npx jest` output shows 0 failures |
| No pre-existing tests were broken | `npx jest` output — no previously passing tests now fail |
| Files are in the correct directories | No files in project root; all in `src/`, `tests/`, `docs/`, `config/`, `scripts/` |
| No `any` types introduced | `npx tsc --noEmit --strict` catches any slippage |
| Code is under 500 lines per file | Check with `wc -l` if uncertain |
| Status section is updated in the task file | `## Status` block shows `DONE` with all required fields |
| Commit is made with correct message format | Commit message follows the `feat(<scope>): ...` format |

---

## Handoff Protocol

After marking a task `DONE`, perform the following handoff steps:

### 1. Identify newly unblocked tasks

Open `00-README.md` Task Index. Find every task whose "Depends On" column includes the task ID you just completed. For each such task, check whether all of its other dependencies are also `DONE`. If yes, that task is now unblocked.

### 2. Announce unblocked tasks

In your completion `Outcome` field, list the newly unblocked tasks explicitly:

```
Unblocked tasks: IMP-002 (LLM Fallback Routing), IMP-003 (Hybrid Keyword Routing)
```

### 3. Leave the codebase in a clean state

Before finishing:
- Run `npx tsc --noEmit` one final time.
- Run `npx jest` one final time.
- Confirm both produce clean output.
- Confirm no uncommitted changes remain (aside from the task status file update, which should be its own commit or part of the feature commit).

### 4. Commit the status update

After the feature commit, make a second commit just for the task file status update if it was not included in the feature commit:

```
chore(tasks): mark IMP-001 DONE [2026-04-06]
```

### 5. Do not start the next task in the same session unless instructed

After completing a task and updating the status file, stop. The orchestrating agent or user decides which task to assign next. Do not autonomously pick up the next task unless explicitly instructed.

---

## Handling Blockers and Deviations

### If you encounter a blocker mid-implementation

Update the task status immediately:

```markdown
## Status
- **Picked up:** YYYY-MM-DD
- **Agent:** <identifier>
- **State:** BLOCKED
- **Blocker:** <description of what is blocking progress>
- **Partial work:** <description of what was completed before the blocker>
- **Suggested resolution:** <what would need to happen to unblock>
```

Do not leave the codebase in a broken state when setting a task to `BLOCKED`. Either complete the partial changes in a compilable/passing state and commit them, or revert them entirely.

### If the spec and the existing code conflict

The improvement plan (`docs/improvement_plan.md`) is the authoritative specification. If the existing code cannot be reconciled with the spec without breaking other things, do not guess — document the conflict in the task's `Outcome` field and ask for guidance before committing.

### If a task's scope is larger than expected

Do not expand the scope of a task beyond what the task file specifies. If you discover that implementing the task correctly requires changes that are not listed in the task's "Files to Modify" section, document this in the `Outcome` field. If the unplanned changes are substantial (more than ~20 lines), create a note rather than silently implementing them.

---

## Quick Reference Commands

```bash
# TypeScript compilation check (run before and after your changes)
npx tsc --noEmit

# Per-package compilation check
npx tsc --noEmit -p v3/@claude-flow/<package>/tsconfig.json

# Run all tests
npx jest

# Run specific test file
npx jest tests/<path>/<module>.test.ts

# Run tests matching a pattern
npx jest --testNamePattern="RouteLayer"

# Run tests with coverage report
npx jest --coverage

# Run tests in watch mode during development
npx jest --watch

# Check a file's line count
wc -l v3/@claude-flow/<package>/src/<file>.ts

# Find TypeScript files in a package
find v3/@claude-flow/<package>/src -name "*.ts" | head -20

# Check git status before committing
git status
git diff --stat

# Stage specific files (never use git add -A or git add .)
git add v3/@claude-flow/<package>/src/<file>.ts tests/<path>/<file>.test.ts

# Commit with heredoc format
git commit -m "$(cat <<'EOF'
feat(<scope>): <description> [IMP-XXX]

<body>

Implements: IMP-XXX
EOF
)"
```

---

## Status Field Reference

| State | Meaning |
|-------|---------|
| `PENDING` | Not yet started. Dependencies may or may not be satisfied. |
| `IN_PROGRESS` | An agent has picked this up and is actively working on it. |
| `BLOCKED` | Agent encountered a blocker. See `Blocker` field for details. |
| `DONE` | All acceptance criteria met, tests pass, TypeScript compiles, committed. |
| `SKIPPED` | Explicitly deferred with documented reason. Not the same as PENDING. |
