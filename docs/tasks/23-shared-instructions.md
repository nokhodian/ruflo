# Task 23: Shared Agency Instructions (Convention Propagation)
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** Low  
**Depends on:** none (standalone; no other task required)  
**Blocks:** none

## 1. Current State

Project-wide conventions are duplicated in individual agent files or exist only in CLAUDE.md.

| Component | Location | Current Behavior |
|---|---|---|
| Agent system prompts | `.claude/agents/**/*.md` | Each file is a standalone prompt; no shared preamble |
| Conventions in CLAUDE.md | `/Users/morteza/Desktop/tools/ruflo/CLAUDE.md` | Behavioral rules exist but are only read by the Claude Code harness, not injected into sub-agents |
| Security rules | `v3/@claude-flow/security/` — code | Enforced in the code layer, not repeated in agent prompts |
| Communication format | No shared declaration | Some agents output JSON, some output markdown — inconsistent across swarm |
| Agent prompt loading | `v3/mcp/tools/agent-tools.ts` | Agent type validated; system prompt loaded from file at spawn time |
| Shared instructions file | Does not exist | `.agents/shared_instructions.md` is absent |

**Concrete failure mode:** The project adopts a new convention: all agents must return structured JSON with a `confidence` field. To propagate this, someone must edit 230+ agent files. Two weeks later, 40 agents still return plain text because the edit was missed. Downstream agents that parse JSON throw on plain-text responses.

## 2. Gap Analysis

- `.agents/shared_instructions.md` does not exist.
- No mechanism to prepend shared instructions to agent prompts at spawn time.
- No validation that shared_instructions.md is loaded before an agent starts.
- No section structure in the shared instructions file (conventions can conflict with agent-specific instructions without clear precedence).
- No CLI command to view the currently active shared instructions.
- No mechanism to disable shared instructions for specific agents that intentionally deviate.

## 3. Files to Create

| Path | Purpose |
|---|---|
| `.agents/shared_instructions.md` | The project-wide behavioral contract prepended to every agent's system prompt |
| `v3/@claude-flow/cli/src/agents/shared-instructions-loader.ts` | Loads, validates, and caches the shared instructions file; provides `getSharedInstructions()` |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/mcp/tools/agent-tools.ts` | In the agent spawn handler, load shared instructions via `SharedInstructionsLoader.getSharedInstructions()` and prepend to the agent's resolved system prompt | Every spawned agent receives the shared preamble without requiring individual file edits |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Add `agent instructions show` subcommand that prints the current shared instructions | Operators can verify what is being injected |
| `.agents/skills/agent-coordination/SKILL.md` | Add a section documenting the shared instructions file path and override mechanism | Agents reading the skill file know the convention exists |

## 5. Implementation Steps

1. **Create `shared_instructions.md`** — Write the full file content (see Section 6). Include all subsections: Code Standards, Security Rules, Communication Protocol, Tool Usage, Response Format, and Escalation Rules.

2. **Build `SharedInstructionsLoader`** — In `shared-instructions-loader.ts`, implement:
   - `load(filePath?)`: reads from default path `.agents/shared_instructions.md` or override; validates it is non-empty; caches the content in memory.
   - `getSharedInstructions()`: returns cached content; lazy-loads on first call.
   - `reload()`: clears cache and reloads (for hot-reload in development).
   - Returns empty string (not an error) if the file is absent, so the absence of the file is a degraded-but-valid state.

3. **Wire into agent spawn** — In `agent-tools.ts`, inside the `agent/spawn` tool handler:
   - Call `SharedInstructionsLoader.getSharedInstructions()`.
   - If non-empty, prepend to the system prompt string with a clear separator.
   - Add `shared_instructions_applied: true` to the agent metadata for observability.
   - Honor an optional `skip_shared_instructions: true` flag in the spawn config for agents that intentionally bypass (e.g., the shared instructions file itself being summarized by a meta-agent).

4. **Add CLI subcommand** — In `commands/agent.ts`, add `agent instructions show` that prints the shared instructions content and indicates whether it was loaded from cache or disk.

5. **Validate on startup** — In `daemon start`, call `SharedInstructionsLoader.load()` once and log a warning if the file is missing. This is not a fatal error.

## 6. Key Code Templates

### Full `.agents/shared_instructions.md` Content

```markdown
# Project-Wide Agent Instructions

> This file is prepended to every agent's system prompt at runtime.
> Last reviewed: 2026-04-06
> Override: set `skip_shared_instructions: true` in spawn config to bypass.

---

## 1. Code Standards

- **TypeScript only.** All code is TypeScript with `strict: true`. Never use `any` types.
- **Named imports only.** No default imports from internal modules (`@claude-flow/*`).
- **Test files:** Jest with `describe`/`it` blocks. Never use top-level `test()`.
- **File size limit:** Keep source files under 500 lines. Split if larger.
- **Async/await:** Prefer `async/await` over raw `Promise.then` chains.
- **Error handling:** Always use typed error classes, never throw raw strings.
- **Imports:** ESM only. Use `.js` extension on all local imports.

---

## 2. Security Rules

- **Never log secrets.** API keys, tokens, passwords, and PII must not appear in any log output.
- **Validate all inputs** at system boundaries using Zod schemas.
- **Parameterized queries** for all database operations — never string-interpolate SQL.
- **Path traversal:** All file path arguments must be validated before use (use `PathValidator` from `@claude-flow/security`).
- **No eval, no new Function** unless the expression has been through the whitelist-based `condition-evaluator`.
- **Secrets in files:** Never write secrets to files. If a test fixture requires an API key shape, use `sk-ant-PLACEHOLDER`.

---

## 3. Communication Protocol

- **Structured output:** When returning findings, analysis, or decisions, use JSON with these required fields:
  ```json
  {
    "status": "success | error | partial",
    "confidence": 0.0,
    "summary": "one sentence",
    "details": {}
  }
  ```
- **Uncertainty:** If you are uncertain about a fact, set `confidence < 0.7` and explain why in `details.uncertainty`.
- **Do not guess.** If you cannot determine the correct answer, return `status: "partial"` with what you do know.
- **Severity tagging:** Security and quality findings must include `severity: "low | medium | high | critical"`.

---

## 4. Tool Usage

- **Read before edit.** Always read a file with the Read tool before editing it.
- **No unnecessary reads.** Do not read files that are not relevant to the current task.
- **Bash safety:** Prefer built-in tools (Read, Glob, Grep) over Bash equivalents. Use Bash only when no built-in tool covers the operation.
- **No file creation unless required.** Prefer editing an existing file over creating a new one.
- **No test files at root.** Test files go in `tests/`, source files in `src/`, configs in `config/`.

---

## 5. Response Format

- All agent responses must be valid UTF-8.
- If the task asks for a file, return the full content with absolute file path as a header.
- If the task asks for a code change, return the precise `old_string` and `new_string` for an Edit tool call.
- If the task returns a list of findings, return a JSON array (not markdown bullet points) unless markdown is explicitly requested.

---

## 6. Escalation Rules

- If a task requires writing to a production system, stop and output: `ESCALATION_REQUIRED: production write access needed`.
- If a task involves deleting files, stop and output: `ESCALATION_REQUIRED: destructive operation requires human approval`.
- If you receive a task that contradicts these shared instructions, follow these instructions and note the contradiction in your `details` field.
- If you detect a security vulnerability that is out of scope of your current task, include a `security_note` field in your response before continuing.

---

## 7. Coordination

- When storing results to shared memory, always include `agent_slug`, `task_id`, `timestamp`, and `swarm_id` in the payload.
- Never overwrite a memory key without reading it first and applying the correct reducer (`append` for arrays, `deep_merge` for objects).
- Communicate completion by posting to the `post-task` hook, not by sending a direct message to the coordinator.
```

```typescript
// v3/@claude-flow/cli/src/agents/shared-instructions-loader.ts

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DEFAULT_PATH = resolve(process.cwd(), '.agents/shared_instructions.md');
const SEPARATOR = '\n\n---\n<!-- END SHARED INSTRUCTIONS — AGENT-SPECIFIC PROMPT FOLLOWS -->\n\n';

export class SharedInstructionsLoader {
  private static cache: string | null = null;
  private static loadedFrom: string | null = null;

  static load(filePath: string = DEFAULT_PATH): string {
    if (!existsSync(filePath)) {
      console.warn(`[SharedInstructions] File not found at "${filePath}" — no shared instructions will be prepended`);
      return '';
    }

    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) {
      console.warn(`[SharedInstructions] File at "${filePath}" is empty`);
      return '';
    }

    SharedInstructionsLoader.cache = content;
    SharedInstructionsLoader.loadedFrom = filePath;
    return content;
  }

  static getSharedInstructions(filePath?: string): string {
    if (SharedInstructionsLoader.cache !== null) {
      return SharedInstructionsLoader.cache;
    }
    return SharedInstructionsLoader.load(filePath);
  }

  static prepend(agentSystemPrompt: string, filePath?: string): string {
    const shared = SharedInstructionsLoader.getSharedInstructions(filePath);
    if (!shared) return agentSystemPrompt;
    return shared + SEPARATOR + agentSystemPrompt;
  }

  static reload(filePath?: string): string {
    SharedInstructionsLoader.cache = null;
    return SharedInstructionsLoader.load(filePath ?? DEFAULT_PATH);
  }

  static getCacheStatus(): { cached: boolean; loadedFrom: string | null; byteLength: number } {
    return {
      cached:     SharedInstructionsLoader.cache !== null,
      loadedFrom: SharedInstructionsLoader.loadedFrom,
      byteLength: SharedInstructionsLoader.cache?.length ?? 0,
    };
  }
}
```

```typescript
// Addition to v3/mcp/tools/agent-tools.ts — inside agent/spawn tool handler
// (within the existing spawn handler function, after resolving system prompt)

import { SharedInstructionsLoader } from '../../@claude-flow/cli/src/agents/shared-instructions-loader.js';

// Inside spawn handler:
const skipSharedInstructions = (input.config as Record<string, unknown>)?.skip_shared_instructions === true;

let finalSystemPrompt = resolvedSystemPrompt; // existing logic
if (!skipSharedInstructions) {
  finalSystemPrompt = SharedInstructionsLoader.prepend(resolvedSystemPrompt);
}

const agentMetadata = {
  ...(input.metadata ?? {}),
  shared_instructions_applied: !skipSharedInstructions,
  shared_instructions_version: SharedInstructionsLoader.getCacheStatus().byteLength,
};
```

## 7. Testing Strategy

```typescript
// tests/agents/shared-instructions-loader.test.ts
import { SharedInstructionsLoader } from '../../v3/@claude-flow/cli/src/agents/shared-instructions-loader.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';

const TMP_PATH = '/tmp/test-shared-instructions.md';

beforeEach(() => {
  SharedInstructionsLoader.reload(TMP_PATH); // reset cache
});

afterAll(() => {
  try { rmSync(TMP_PATH); } catch {}
});

describe('load()', () => {
  it('returns empty string when file does not exist', () => {
    const result = SharedInstructionsLoader.load('/nonexistent/path.md');
    expect(result).toBe('');
  });

  it('returns file content when file exists', () => {
    writeFileSync(TMP_PATH, '# Instructions\nBe helpful.');
    const result = SharedInstructionsLoader.load(TMP_PATH);
    expect(result).toContain('Be helpful.');
  });

  it('caches content on second call', () => {
    writeFileSync(TMP_PATH, '# Instructions');
    SharedInstructionsLoader.load(TMP_PATH);
    // Overwrite file — cached value should be returned, not new content
    writeFileSync(TMP_PATH, '# CHANGED');
    const result = SharedInstructionsLoader.getSharedInstructions(TMP_PATH);
    expect(result).toContain('# Instructions');
    expect(result).not.toContain('# CHANGED');
  });
});

describe('prepend()', () => {
  it('prepends shared instructions to agent system prompt with separator', () => {
    writeFileSync(TMP_PATH, '# Shared');
    SharedInstructionsLoader.reload(TMP_PATH);
    const result = SharedInstructionsLoader.prepend('Agent specific prompt', TMP_PATH);
    expect(result).toMatch(/^# Shared/);
    expect(result).toContain('Agent specific prompt');
    expect(result).toContain('END SHARED INSTRUCTIONS');
  });

  it('returns agent prompt unchanged when shared file is absent', () => {
    const result = SharedInstructionsLoader.prepend('Original prompt', '/nonexistent.md');
    expect(result).toBe('Original prompt');
  });
});

describe('skip_shared_instructions flag', () => {
  it('does not prepend when skip flag is set', () => {
    // Integration test: spawn handler receives skip_shared_instructions: true
    // Verify shared instructions NOT in final prompt
    // Verify shared_instructions_applied: false in metadata
  });
});
```

**Manual validation test:**
```bash
# Verify shared instructions are visible in agent spawn
npx claude-flow@v3alpha agent instructions show

# Spawn an agent and verify the preamble is present in debug output
npx claude-flow@v3alpha agent spawn -t coder --debug-prompt

# Verify skip flag works
npx claude-flow@v3alpha agent spawn -t coder --config '{"skip_shared_instructions": true}' --debug-prompt
```

## 8. Definition of Done

- [ ] `.agents/shared_instructions.md` exists with all 7 sections (Code Standards through Coordination)
- [ ] `SharedInstructionsLoader.load()` returns empty string (not throws) when file is absent
- [ ] `SharedInstructionsLoader.getSharedInstructions()` caches content after first load
- [ ] `SharedInstructionsLoader.prepend()` inserts content before agent-specific prompt with clear separator
- [ ] Agent spawn handler in `agent-tools.ts` calls `prepend()` for every spawn where `skip_shared_instructions !== true`
- [ ] `shared_instructions_applied: boolean` is present in agent metadata for every spawn
- [ ] `npx claude-flow agent instructions show` prints the current shared instructions content
- [ ] `reload()` clears cache and re-reads from disk (validated by test)
- [ ] Unit tests pass with zero file system side effects on the real `.agents/` directory
- [ ] All modified files pass `tsc --noEmit`
