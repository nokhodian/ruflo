# Task 04: Structured Agent Capability Metadata

**Priority:** Phase 1 — Foundation  
**Effort:** Low  
**Depends on:** none  
**Blocks:** 01-semantic-route-layer (HNSW re-indexing improvement)

---

## 1. Current State

All 230+ agent definitions live in `.claude/agents/**/*.md`. Each file has YAML frontmatter at the top followed by a system prompt body.

**Current frontmatter format** (example from a typical agent file):
```yaml
---
name: Security Engineer
description: >
  Expert in application security, vulnerability assessment, and secure coding practices.
  Specializes in identifying and remediating security vulnerabilities...
tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---
```

The frontmatter fields are: `name` (string), `description` (multi-line string), `tools` (comma-separated string).

**HNSW indexing** in `v3/@claude-flow/memory/src/hnsw-index.ts` indexes the **full agent file content** (system prompt body + frontmatter). This means the embedding includes:
- Role-playing instructions ("You are a security expert...")
- Behavioral rules ("Never log secrets...")
- Tool usage examples
- Long procedural guidance

All of this text dilutes the semantic signal that describes what the agent *does*, causing poor retrieval precision when the RouteLayer (Task 01) tries to use HNSW for routing.

**Directory structure** (verified from `ls .claude/agents/`):
```
.claude/agents/
├── academic/
├── analysis/
├── architecture/
├── base-template-generator.md
├── consensus/
├── core/
├── custom/
├── data/
├── database-specialist.md
├── design/
├── development/
├── devops/
├── documentation/
├── dual-mode/
├── engineering/
├── flow-nexus/
├── game-development/
├── github/
├── goal/
├── hive-mind/
... (and more)
```

**Indexer location**: `v3/@claude-flow/memory/src/` — check `hnsw-index.ts` and `agentdb-adapter.ts` to understand current indexing behavior.

---

## 2. Gap Analysis

**What is missing:**

1. **No structured `capability:` block in any agent frontmatter.** There is no machine-readable field distinguishing role, goal, expertise areas, task types, or output type.
2. **HNSW is indexed from full system prompt text.** The signal-to-noise ratio is poor. A security engineer's prompt contains 60% behavioral rules and only 40% capability description.
3. **No `input_schema` / `output_schema` references in frontmatter.** Task 05 (typed I/O contracts) needs these as anchors in agent definitions.
4. **No `version` field in agent frontmatter.** Required for agent versioning (future task).
5. **No `task_types` enumeration.** No machine-readable list of what task categories each agent handles.

**Failure modes without this task:**
- RouteLayer HNSW integration (Task 01 Phase 2) remains low-precision because the embeddings contain noise
- Task 05 (typed I/O) has no frontmatter anchor to reference schema files
- Agent specialization scoring (future task) has no `task_types` field to track

**Scope clarification:** This task does NOT re-index HNSW (that is a follow-on step). This task:
1. Defines the `capability:` frontmatter schema
2. Adds the `capability:` block to a representative sample of agents (the most commonly used ones)
3. Updates the memory indexer to prefer `capability.*` fields over full system prompt when available
4. Creates a validation script to check that added capability blocks are well-formed

The full rollout to all 230+ agents can proceed incrementally; this task establishes the schema and tooling.

---

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `docs/agent-capability-schema.md` | Human-readable schema reference for the `capability:` frontmatter block |
| `scripts/validate-capability-metadata.ts` | Script that reads all agent `.md` files, parses frontmatter, validates `capability:` against the schema |
| `scripts/add-capability-template.ts` | Script that generates a `capability:` block template for a given agent file, ready to fill in |
| `tests/scripts/validate-capability-metadata.test.ts` | Tests for the validator script |

---

## 4. Files to Modify

| Path | Change |
|------|--------|
| **20 high-priority agent files** — listed in Step 2 | Add `capability:` block to frontmatter |
| `v3/@claude-flow/memory/src/hnsw-index.ts` | When indexing an agent file, prefer structured `capability.*` fields over full prompt text if present |
| `v3/@claude-flow/memory/src/agentdb-adapter.ts` | Pass `capability` data as structured metadata when calling HNSW |

The 20 high-priority agent files to update first (most commonly routed agents):

1. `.claude/agents/engineering/security-engineer.md`
2. `.claude/agents/engineering/backend-architect.md`
3. `.claude/agents/engineering/frontend-developer.md`
4. `.claude/agents/engineering/code-reviewer.md`
5. `.claude/agents/engineering/devops-automator.md`
6. `.claude/agents/engineering/software-architect.md`
7. `.claude/agents/engineering/senior-developer.md`
8. `.claude/agents/core/coder.md` (or wherever core agents live)
9. `.claude/agents/core/reviewer.md`
10. `.claude/agents/core/tester.md`
11. `.claude/agents/core/researcher.md`
12. `.claude/agents/core/planner.md`
13. `.claude/agents/development/tdd-london-swarm.md`
14. `.claude/agents/devops/engineering-devops-automator.md`
15. `.claude/agents/engineering/git-workflow-master.md`
16. `.claude/agents/consensus/hierarchical-coordinator.md`
17. `.claude/agents/architecture/system-architect.md`
18. `.claude/agents/engineering/technical-writer.md`
19. `.claude/agents/engineering/database-optimizer.md`
20. `.claude/agents/engineering/sre.md`

**IMPORTANT:** Before editing any agent file, use the Read tool to read its current contents first, then use Edit to make targeted changes.

---

## 5. Implementation Steps

### Step 1: Define the capability schema

Create `docs/agent-capability-schema.md` defining every valid field in the `capability:` YAML block. See Section 6 for the full schema definition.

### Step 2: Read the first agent file to understand structure

Before modifying any agent file:
```
Read .claude/agents/engineering/security-engineer.md  (or the correct path)
```
Verify the exact frontmatter structure. If the file doesn't exist at that exact path, use Glob to find agent files:
```
Glob pattern: .claude/agents/**/*.md
```

### Step 3: Add `capability:` blocks to the 20 priority agent files

For each file:
1. Read the file with the Read tool
2. Parse the existing frontmatter to understand the agent's current description
3. Generate a `capability:` block appropriate for that agent
4. Use the Edit tool to insert the `capability:` block into the frontmatter (after the existing `tools:` field, before the closing `---`)

**Example edit for `engineering-security-engineer.md`:**
```yaml
# BEFORE (existing):
---
name: Security Engineer
description: >
  Expert in application security...
tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---

# AFTER (with capability block added):
---
name: Security Engineer
description: >
  Expert in application security...
tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
capability:
  role: security-engineer
  goal: Identify and remediate security vulnerabilities in code and infrastructure
  version: "1.0.0"
  expertise:
    - application security
    - OWASP Top 10
    - CVE analysis and remediation
    - authentication and authorization systems
    - cryptography and key management
    - dependency vulnerability scanning
    - penetration testing
    - threat modeling
  task_types:
    - security-audit
    - vulnerability-scan
    - cve-remediation
    - dependency-review
    - auth-security-review
    - code-security-review
  output_type: SecurityAuditReport
  input_schema: "schemas/generic-task-input.json"
  output_schema: "schemas/security-audit-output.json"
  planning_step: required
  model_preference:
    default: sonnet
    max_cost_usd: 0.10
---
```

### Step 4: Create the validation script

Create `scripts/validate-capability-metadata.ts` — see Section 6. This script:
1. Globs all `*.md` files in `.claude/agents/`
2. Parses the YAML frontmatter of each
3. For files that have a `capability:` block, validates all required fields are present and have correct types
4. Reports: total files checked, files with capability block, files missing capability, validation errors

### Step 5: Create the template generator script

Create `scripts/add-capability-template.ts` — a utility that:
1. Accepts a file path as CLI argument
2. Reads the file
3. Prints a pre-filled `capability:` block template based on the existing `name` and `description` fields
4. Does NOT write to the file — just prints to stdout for the developer to paste in

### Step 6: Modify HNSW indexer

Read `v3/@claude-flow/memory/src/hnsw-index.ts` to understand the current indexing API.

The modification: when building the text to embed for an agent file, check if `capability` field exists in the parsed frontmatter. If yes, construct the embedding text from structured fields:

```typescript
function buildAgentEmbeddingText(agentDoc: AgentDocument): string {
  if (agentDoc.capability) {
    const { role, goal, expertise, task_types } = agentDoc.capability;
    return [
      `Role: ${role}`,
      `Goal: ${goal}`,
      `Expertise: ${expertise.join(', ')}`,
      `Task types: ${task_types.join(', ')}`,
    ].join('\n');
  }
  // Fallback: use description field only (not full system prompt)
  return agentDoc.description ?? agentDoc.name;
}
```

---

## 6. Key Code Templates

### Capability Schema (`docs/agent-capability-schema.md`)

The `capability:` block is added to agent frontmatter. Fields:

```yaml
capability:
  # REQUIRED fields:
  role: string                    # kebab-case agent role identifier
  goal: string                    # one-sentence goal statement (50-150 chars)
  version: string                 # semver: "1.0.0"
  expertise: string[]             # 3-12 domain expertise areas (lowercase)
  task_types: string[]            # 2-8 task type identifiers (kebab-case)
  output_type: string             # PascalCase name of the primary output type

  # OPTIONAL fields:
  input_schema: string            # path to JSON Schema file for agent input
  output_schema: string           # path to JSON Schema file for agent output
  planning_step: string           # 'required' | 'optional' | 'disabled'
  model_preference:
    default: string               # 'haiku' | 'sonnet' | 'opus'
    max_cost_usd: number          # budget cap per invocation
    extended_thinking: boolean    # default: false
  knowledge_sources:
    shared: string[]              # paths to shared knowledge docs
    private: string[]             # paths to agent-private knowledge docs
  triggers:                       # microagent trigger patterns
    - pattern: string             # regex string
      mode: string                # 'inject' | 'takeover'
  termination:
    max_turns: integer            # default: 20
    max_cost_usd: number          # default: 0.50
    timeout_ms: integer           # default: 120000
    stop_on_phrases: string[]     # e.g., ["TASK_COMPLETE", "CANNOT_PROCEED"]
```

Valid `task_types` values (extend this list as needed):
- `feature-development`, `bug-fix`, `code-review`, `refactoring`
- `security-audit`, `vulnerability-scan`, `cve-remediation`, `penetration-testing`
- `architecture-design`, `system-design`, `api-design`
- `performance-optimization`, `profiling`, `benchmarking`
- `test-writing`, `test-review`, `ci-cd-setup`
- `database-design`, `query-optimization`, `migration`
- `documentation-writing`, `api-docs`
- `devops-automation`, `deployment`, `infrastructure-as-code`
- `mobile-development`, `frontend-development`, `backend-development`
- `dependency-review`, `dependency-upgrade`
- `research`, `analysis`, `investigation`

### `scripts/validate-capability-metadata.ts`
```typescript
#!/usr/bin/env node
/**
 * Validates that agent .md files with capability: blocks conform to the schema.
 * Run: npx tsx scripts/validate-capability-metadata.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { parse as parseYaml } from 'yaml';

const AGENTS_DIR = '.claude/agents';

interface ValidationError {
  file: string;
  field: string;
  message: string;
}

interface CapabilityBlock {
  role?: unknown;
  goal?: unknown;
  version?: unknown;
  expertise?: unknown;
  task_types?: unknown;
  output_type?: unknown;
  [key: string]: unknown;
}

function validateCapabilityBlock(capability: CapabilityBlock, filePath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  const required = ['role', 'goal', 'version', 'expertise', 'task_types', 'output_type'];
  for (const field of required) {
    if (!capability[field]) {
      errors.push({ file: filePath, field, message: `Required field "${field}" is missing` });
    }
  }

  if (capability.role && typeof capability.role !== 'string') {
    errors.push({ file: filePath, field: 'role', message: 'Must be a string' });
  }

  if (capability.goal && typeof capability.goal !== 'string') {
    errors.push({ file: filePath, field: 'goal', message: 'Must be a string' });
  }
  if (capability.goal && typeof capability.goal === 'string') {
    if (capability.goal.length < 20 || capability.goal.length > 200) {
      errors.push({ file: filePath, field: 'goal', message: 'Should be 20-200 characters' });
    }
  }

  if (capability.expertise && !Array.isArray(capability.expertise)) {
    errors.push({ file: filePath, field: 'expertise', message: 'Must be an array of strings' });
  }
  if (Array.isArray(capability.expertise) && capability.expertise.length < 3) {
    errors.push({ file: filePath, field: 'expertise', message: 'Should have at least 3 entries' });
  }

  if (capability.task_types && !Array.isArray(capability.task_types)) {
    errors.push({ file: filePath, field: 'task_types', message: 'Must be an array of strings' });
  }
  if (Array.isArray(capability.task_types) && capability.task_types.length < 1) {
    errors.push({ file: filePath, field: 'task_types', message: 'Should have at least 1 entry' });
  }

  if (capability.version && !/^\d+\.\d+\.\d+$/.test(String(capability.version))) {
    errors.push({ file: filePath, field: 'version', message: 'Must be semver format (x.y.z)' });
  }

  return errors;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return parseYaml(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function globMd(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...globMd(full));
    } else if (extname(entry) === '.md') {
      results.push(full);
    }
  }
  return results;
}

async function main() {
  const files = globMd(AGENTS_DIR);
  let withCapability = 0;
  let withoutCapability = 0;
  const allErrors: ValidationError[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) continue;

    if (frontmatter.capability) {
      withCapability++;
      const errors = validateCapabilityBlock(
        frontmatter.capability as CapabilityBlock,
        file
      );
      allErrors.push(...errors);
    } else {
      withoutCapability++;
    }
  }

  console.log(`\nAgent Capability Metadata Validation`);
  console.log(`=====================================`);
  console.log(`Total files scanned: ${files.length}`);
  console.log(`Files with capability block: ${withCapability}`);
  console.log(`Files without capability block: ${withoutCapability}`);
  console.log(`Validation errors: ${allErrors.length}`);

  if (allErrors.length > 0) {
    console.log(`\nErrors:`);
    for (const err of allErrors) {
      console.log(`  [${err.file}] ${err.field}: ${err.message}`);
    }
    process.exit(1);
  } else {
    console.log(`\nAll capability blocks are valid.`);
  }
}

main();
```

### HNSW indexer modification (`v3/@claude-flow/memory/src/hnsw-index.ts`)

Add this helper function and call it from the indexing path. Read the file first to find the correct insertion point.

```typescript
/**
 * Build the embedding text for an agent document.
 * Prefers structured capability fields over full system prompt for better signal.
 */
function buildAgentEmbeddingText(agentDoc: {
  name?: string;
  description?: string;
  capability?: {
    role?: string;
    goal?: string;
    expertise?: string[];
    task_types?: string[];
  };
}): string {
  if (agentDoc.capability) {
    const parts: string[] = [];
    if (agentDoc.capability.role) parts.push(`Role: ${agentDoc.capability.role}`);
    if (agentDoc.capability.goal) parts.push(`Goal: ${agentDoc.capability.goal}`);
    if (agentDoc.capability.expertise?.length) {
      parts.push(`Expertise: ${agentDoc.capability.expertise.join(', ')}`);
    }
    if (agentDoc.capability.task_types?.length) {
      parts.push(`Task types: ${agentDoc.capability.task_types.join(', ')}`);
    }
    if (parts.length > 0) return parts.join('\n');
  }
  // Fallback: use description (not full body text)
  return agentDoc.description ?? agentDoc.name ?? '';
}
```

---

## 7. Testing Strategy

### Validation Script Tests (`tests/scripts/validate-capability-metadata.test.ts`)

```typescript
import { validateCapabilityBlock } from '../../scripts/validate-capability-metadata.js';

describe('validateCapabilityBlock', () => {
  const validCapability = {
    role: 'security-engineer',
    goal: 'Identify and remediate security vulnerabilities in code and infrastructure',
    version: '1.0.0',
    expertise: ['application security', 'OWASP', 'CVE analysis'],
    task_types: ['security-audit', 'vulnerability-scan'],
    output_type: 'SecurityAuditReport',
  };

  it('returns no errors for a valid block', () => {
    const errors = validateCapabilityBlock(validCapability, 'test.md');
    expect(errors).toHaveLength(0);
  });

  it('reports missing required fields', () => {
    const errors = validateCapabilityBlock({}, 'test.md');
    expect(errors.length).toBeGreaterThanOrEqual(6); // all required fields
    const fields = errors.map(e => e.field);
    expect(fields).toContain('role');
    expect(fields).toContain('goal');
    expect(fields).toContain('expertise');
    expect(fields).toContain('task_types');
  });

  it('rejects non-semver version', () => {
    const errors = validateCapabilityBlock({ ...validCapability, version: 'v1.0' }, 'test.md');
    expect(errors.some(e => e.field === 'version')).toBe(true);
  });

  it('rejects expertise with fewer than 3 entries', () => {
    const errors = validateCapabilityBlock({ ...validCapability, expertise: ['one', 'two'] }, 'test.md');
    expect(errors.some(e => e.field === 'expertise')).toBe(true);
  });

  it('rejects goal shorter than 20 characters', () => {
    const errors = validateCapabilityBlock({ ...validCapability, goal: 'too short' }, 'test.md');
    expect(errors.some(e => e.field === 'goal')).toBe(true);
  });
});
```

### Manual Verification Checklist

After adding capability blocks to the 20 priority agents:
1. Run `npx tsx scripts/validate-capability-metadata.ts` — must exit 0
2. Verify each block has: `role`, `goal`, `version`, `expertise` (3+), `task_types` (1+), `output_type`
3. Verify no agent file has been truncated (compare line counts before/after)

---

## 8. Definition of Done

- [ ] `docs/agent-capability-schema.md` defines all valid capability fields with types and constraints
- [ ] `capability:` block added to all 20 priority agent files listed in Step 3
- [ ] Each added block contains all 6 required fields: `role`, `goal`, `version`, `expertise`, `task_types`, `output_type`
- [ ] `scripts/validate-capability-metadata.ts` exists and runs without errors on the updated agents
- [ ] `scripts/add-capability-template.ts` generates valid template YAML for any agent file
- [ ] `v3/@claude-flow/memory/src/hnsw-index.ts` updated to use `buildAgentEmbeddingText()` when `capability` field is present
- [ ] HNSW indexer falls back to `description` (not full body text) when capability block is absent
- [ ] Validation script tests pass
- [ ] No existing agent system prompt body text modified (only frontmatter additions)
- [ ] No TypeScript `any` types in new/modified TypeScript files
