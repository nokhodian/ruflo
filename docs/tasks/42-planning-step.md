# Task 42: Mandatory Planning Step Before Execution

**Priority:** Phase 4 — Advanced Features
**Effort:** Low
**Depends on:** (none — standalone frontmatter + hook change)
**Blocks:** Task 43 (Confidence-Gated Input — planning output is the natural place to emit confidence scores)

---

## 1. Current State

Ruflo agents dive into execution with no mandatory pre-execution planning phase. There is no `planning_step` concept in any agent frontmatter or hook.

Relevant files:

- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/specialized/lsp-index-engineer.md` — example agent file; frontmatter contains `name`, `description`, `color`, `emoji`, `vibe`, `tools` only. No `capability` block exists.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/` — hooks directory; `pre-task.ts` exists in the CLI commands path but no planning injection exists inside any hook.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts` — CLI hooks command; `pre-task` is listed as a hook but calls no planning check.
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` (line 152) has no `require_plan` field.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/index.ts` — background worker index; no planning worker.

**Current agent frontmatter schema (from `lsp-index-engineer.md`):**
```yaml
---
name: LSP/Index Engineer
description: ...
color: orange
emoji: 🔎
vibe: ...
tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---
```

No `capability` block, no `planning_step`, no `plan_format`, no planning enforcement.

---

## 2. Gap Analysis

**What is missing:**

1. No `capability.planning_step` field in agent frontmatter — agents have no self-declared planning requirement.
2. No planning injection in `pre-task` hook — no system prompt segment that demands a plan before tool use.
3. No `plan_format` validation — even if an agent produces a plan, there is no schema check.
4. No CI-mode bypass — interactive vs. non-interactive contexts both get same behavior (none).
5. No plan persistence — plans are not stored in AgentDB for retrospective review.
6. `spawnAgentSchema` cannot request a plan at spawn time.

**Concrete failure modes:**

- An agent tasked with "refactor authentication" immediately starts editing files without declaring which files it will touch. Errors on file 7 of 12 waste all upstream work.
- A code-generation agent in a 10-step pipeline produces output incompatible with step 6 because it never modeled the downstream contract.
- Operators cannot redirect an agent mid-task because they have no visibility into its intended action sequence before tokens are spent.
- Swarm coordinator spawns agents that duplicate work because no agent declared its planned scope.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/hooks/src/planning/plan-validator.ts` | Validates a plan string against the configured `plan_format` schema |
| `v3/@claude-flow/hooks/src/planning/planning-prompt.ts` | Generates the planning system prompt segment injected before agent execution |
| `v3/@claude-flow/hooks/src/planning/types.ts` | `PlanningConfig`, `AgentPlan`, `PlanFormat` types |
| `v3/@claude-flow/hooks/src/planning/index.ts` | Barrel export |
| `v3/@claude-flow/hooks/src/__tests__/planning-step.test.ts` | Unit tests for plan validation and prompt generation |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `.claude/agents/specialized/lsp-index-engineer.md` | Add example `capability.planning_step: required` and `capability.plan_format: numbered-list` to frontmatter as the canonical reference implementation. |
| `v3/@claude-flow/hooks/src/workers/session-hook.ts` | In the `pre-task` handler, call `PlanningPrompt.inject(agentConfig)` to prepend the planning instruction to the agent system prompt when `planning_step !== 'disabled'`. |
| `v3/mcp/tools/agent-tools.ts` | Add `require_plan: z.enum(['required', 'optional', 'disabled']).default('optional')` and `plan_format: z.enum(['numbered-list', 'json', 'markdown']).default('numbered-list')` to `spawnAgentSchema`. |
| `v3/@claude-flow/cli/src/commands/hooks.ts` | In `pre-task` CLI handler, read `planning_step` from agent config and call the planning validator if a plan is provided in stdin context. |

---

## 5. Implementation Steps

**Step 1 — Define planning types**

Create `v3/@claude-flow/hooks/src/planning/types.ts`:

```typescript
export type PlanFormat = 'numbered-list' | 'json' | 'markdown';
export type PlanningMode = 'required' | 'optional' | 'disabled';

export interface PlanningConfig {
  mode: PlanningMode;
  format: PlanFormat;
  autoApproveInCI: boolean;    // skip human gate in CI (env: CI=true)
  maxPlanSteps: number;         // reject plans with more than N steps (default: 20)
  storePlan: boolean;           // persist plan to AgentDB (default: true)
}

export interface PlanStep {
  index: number;
  description: string;
  filesTouched?: string[];
  toolsRequired?: string[];
  expectedOutput?: string;
}

export interface AgentPlan {
  planId: string;
  agentId: string;
  taskDescription: string;
  format: PlanFormat;
  steps: PlanStep[];
  rawText: string;
  createdAt: Date;
  approvedBy?: 'auto' | 'human';
  approvedAt?: Date;
}
```

**Step 2 — Build planning prompt generator**

Create `v3/@claude-flow/hooks/src/planning/planning-prompt.ts`. See Key Code Templates section.

**Step 3 — Build plan validator**

Create `v3/@claude-flow/hooks/src/planning/plan-validator.ts`. See Key Code Templates section.

**Step 4 — Inject planning into `pre-task` hook**

Edit `v3/@claude-flow/hooks/src/workers/session-hook.ts`. In the `pre-task` section, add after existing hook logic:

```typescript
import { PlanningPrompt } from '../planning/planning-prompt.js';
import { PlanValidator } from '../planning/plan-validator.js';

// Inside pre-task handler:
const planningConfig = agentConfig?.capability?.planning_step;
if (planningConfig && planningConfig.mode !== 'disabled') {
  const planningInstruction = PlanningPrompt.inject(planningConfig);
  // Prepend to system prompt context that gets sent to the agent
  context.systemPromptAdditions = [planningInstruction, ...(context.systemPromptAdditions ?? [])];
}
```

**Step 5 — Add `require_plan` to spawn schema**

Edit `v3/mcp/tools/agent-tools.ts`. In `spawnAgentSchema` (starting line 152), add inside the `z.object({...})`:

```typescript
require_plan: z.enum(['required', 'optional', 'disabled']).default('optional')
  .describe('Whether this agent must produce a plan before executing'),
plan_format: z.enum(['numbered-list', 'json', 'markdown']).default('numbered-list')
  .describe('Format the agent must use for its plan'),
```

**Step 6 — Update example agent frontmatter**

Edit `/Users/morteza/Desktop/tools/ruflo/.claude/agents/specialized/lsp-index-engineer.md`. Add after the `tools:` line in frontmatter:

```yaml
capability:
  planning_step: required
  plan_format: numbered-list
  plan_auto_approve_ci: true
  max_plan_steps: 15
```

**Step 7 — Write tests**

Create `v3/@claude-flow/hooks/src/__tests__/planning-step.test.ts`. See Testing Strategy section.

**Step 8 — Barrel export**

Create `v3/@claude-flow/hooks/src/planning/index.ts`:

```typescript
export { PlanningPrompt } from './planning-prompt.js';
export { PlanValidator } from './plan-validator.js';
export type { PlanningConfig, AgentPlan, PlanStep, PlanFormat, PlanningMode } from './types.js';
```

---

## 6. Key Code Templates

### `planning-prompt.ts`

```typescript
import type { PlanningConfig, PlanFormat } from './types.js';

const FORMAT_INSTRUCTIONS: Record<PlanFormat, string> = {
  'numbered-list': `Output a numbered list where each item describes:
1. What you will do (action verb)
2. Which file or tool is involved
3. Expected outcome

Example:
1. Read src/auth/jwt.ts to understand current token validation logic
2. Edit src/auth/jwt.ts — replace HS256 with RS256 algorithm
3. Write tests/auth/jwt.test.ts — add test cases for RS256 validation
4. Run Bash: npm test -- --testPathPattern=jwt to verify changes`,

  'json': `Output a JSON object with this shape:
{
  "steps": [
    {
      "index": 1,
      "description": "string",
      "filesTouched": ["string"],
      "toolsRequired": ["Read", "Edit"],
      "expectedOutput": "string"
    }
  ]
}`,

  'markdown': `Output a markdown section:
## Plan
### Step 1: [Title]
- **Action**: [what you will do]
- **Files**: [files involved]
- **Tools**: [tools to use]
- **Output**: [expected result]`,
};

export class PlanningPrompt {
  static inject(config: PlanningConfig): string {
    const isCI = process.env.CI === 'true' || process.env.CI === '1';
    const approvalNote = (config.autoApproveInCI && isCI)
      ? 'In CI mode, proceed automatically after outputting your plan.'
      : 'Wait for human approval before proceeding. Output only your plan, then STOP.';

    return `## MANDATORY PLANNING STEP

Before taking any action or calling any tool, you MUST output a complete plan.

${FORMAT_INSTRUCTIONS[config.format]}

Constraints:
- Maximum ${config.maxPlanSteps} steps. If your plan requires more, break the task into sub-tasks.
- Do not call any tools until your plan is complete.
- ${approvalNote}

BEGIN YOUR PLAN NOW:`;
  }

  static buildCIApprovalBypass(): string {
    return '\n\n[CI_MODE: Plan auto-approved. Proceeding with execution.]\n';
  }
}
```

### `plan-validator.ts`

```typescript
import { z } from 'zod';
import type { AgentPlan, PlanFormat, PlanStep } from './types.js';
import { randomBytes } from 'crypto';

const numberedListStepRegex = /^\d+\.\s+.{10,}/;

const jsonPlanSchema = z.object({
  steps: z.array(z.object({
    index: z.number().int().positive(),
    description: z.string().min(10),
    filesTouched: z.array(z.string()).optional(),
    toolsRequired: z.array(z.string()).optional(),
    expectedOutput: z.string().optional(),
  })).min(1),
});

export class PlanValidator {
  /**
   * Parses and validates a raw plan string based on the configured format.
   * Throws if the plan does not meet format requirements.
   */
  static validate(
    rawText: string,
    format: PlanFormat,
    agentId: string,
    taskDescription: string,
    maxSteps: number = 20
  ): AgentPlan {
    let steps: PlanStep[];

    switch (format) {
      case 'numbered-list': {
        const lines = rawText.split('\n').filter(l => numberedListStepRegex.test(l.trim()));
        if (lines.length === 0) {
          throw new Error(`Plan validation failed: no numbered steps found in output. Format required: numbered-list.`);
        }
        if (lines.length > maxSteps) {
          throw new Error(`Plan has ${lines.length} steps but maximum allowed is ${maxSteps}.`);
        }
        steps = lines.map((line, i) => ({
          index: i + 1,
          description: line.replace(/^\d+\.\s+/, '').trim(),
        }));
        break;
      }

      case 'json': {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('Plan validation failed: no JSON object found in output.');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error(`Plan validation failed: invalid JSON — ${(e as Error).message}`);
        }
        const result = jsonPlanSchema.safeParse(parsed);
        if (!result.success) {
          throw new Error(`Plan validation failed: ${result.error.message}`);
        }
        if (result.data.steps.length > maxSteps) {
          throw new Error(`Plan has ${result.data.steps.length} steps but maximum is ${maxSteps}.`);
        }
        steps = result.data.steps;
        break;
      }

      case 'markdown': {
        const headings = rawText.match(/^###\s+Step\s+\d+/gm);
        if (!headings || headings.length === 0) {
          throw new Error('Plan validation failed: no "### Step N:" headings found. Format required: markdown.');
        }
        if (headings.length > maxSteps) {
          throw new Error(`Plan has ${headings.length} steps but maximum is ${maxSteps}.`);
        }
        steps = headings.map((h, i) => ({
          index: i + 1,
          description: h.replace(/^###\s+Step\s+\d+:\s*/, '').trim(),
        }));
        break;
      }
    }

    return {
      planId: randomBytes(8).toString('hex'),
      agentId,
      taskDescription,
      format,
      steps,
      rawText,
      createdAt: new Date(),
    };
  }
}
```

---

## 7. Testing Strategy

File: `v3/@claude-flow/hooks/src/__tests__/planning-step.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { PlanningPrompt } from '../planning/planning-prompt.js';
import { PlanValidator } from '../planning/plan-validator.js';

describe('PlanningPrompt.inject', () => {
  it('includes MANDATORY PLANNING STEP header', () => {
    const prompt = PlanningPrompt.inject({
      mode: 'required', format: 'numbered-list',
      autoApproveInCI: false, maxPlanSteps: 20, storePlan: true,
    });
    expect(prompt).toContain('MANDATORY PLANNING STEP');
  });

  it('instructs agent to STOP when not in CI mode', () => {
    delete process.env.CI;
    const prompt = PlanningPrompt.inject({
      mode: 'required', format: 'numbered-list',
      autoApproveInCI: false, maxPlanSteps: 20, storePlan: true,
    });
    expect(prompt).toContain('STOP');
  });

  it('auto-proceeds in CI mode when autoApproveInCI is true', () => {
    process.env.CI = 'true';
    const prompt = PlanningPrompt.inject({
      mode: 'required', format: 'numbered-list',
      autoApproveInCI: true, maxPlanSteps: 20, storePlan: true,
    });
    expect(prompt).toContain('proceed automatically');
    delete process.env.CI;
  });

  it('emits JSON format instructions for json format', () => {
    const prompt = PlanningPrompt.inject({
      mode: 'required', format: 'json',
      autoApproveInCI: false, maxPlanSteps: 20, storePlan: true,
    });
    expect(prompt).toContain('"steps"');
  });
});

describe('PlanValidator.validate (numbered-list)', () => {
  const goodPlan = `1. Read src/auth.ts to understand current implementation
2. Edit src/auth.ts to add RS256 support
3. Write tests/auth.test.ts with new test cases`;

  it('parses a valid numbered-list plan', () => {
    const plan = PlanValidator.validate(goodPlan, 'numbered-list', 'agent-1', 'task');
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].index).toBe(1);
  });

  it('throws when no numbered steps are found', () => {
    expect(() =>
      PlanValidator.validate('No steps here', 'numbered-list', 'agent-1', 'task')
    ).toThrow('no numbered steps found');
  });

  it('throws when step count exceeds maxSteps', () => {
    const tooManySteps = Array.from({ length: 25 }, (_, i) =>
      `${i + 1}. Step description that is long enough to be valid`
    ).join('\n');
    expect(() =>
      PlanValidator.validate(tooManySteps, 'numbered-list', 'agent-1', 'task', 20)
    ).toThrow('maximum allowed is 20');
  });
});

describe('PlanValidator.validate (json)', () => {
  const goodJSON = `{"steps":[{"index":1,"description":"Read the authentication module"}]}`;

  it('parses a valid JSON plan', () => {
    const plan = PlanValidator.validate(goodJSON, 'json', 'agent-1', 'task');
    expect(plan.steps[0].description).toBe('Read the authentication module');
  });

  it('throws on invalid JSON', () => {
    expect(() =>
      PlanValidator.validate('{bad json}', 'json', 'agent-1', 'task')
    ).toThrow('invalid JSON');
  });
});

describe('PlanValidator.validate (markdown)', () => {
  const goodMarkdown = `## Plan\n### Step 1: Read files\n- Action: read\n### Step 2: Edit files\n- Action: edit`;

  it('parses markdown plan headings', () => {
    const plan = PlanValidator.validate(goodMarkdown, 'markdown', 'agent-1', 'task');
    expect(plan.steps).toHaveLength(2);
  });
});
```

---

## 8. Definition of Done

- [ ] `PlanningConfig`, `AgentPlan`, `PlanStep` types exported from `planning/index.ts`.
- [ ] `PlanningPrompt.inject` generates correct instructions for all 3 formats (`numbered-list`, `json`, `markdown`).
- [ ] `PlanValidator.validate` successfully parses and rejects plans in all 3 formats.
- [ ] `spawnAgentSchema` in `agent-tools.ts` includes `require_plan` and `plan_format` fields.
- [ ] `pre-task` hook injects planning prompt when `planning_step !== 'disabled'`.
- [ ] `lsp-index-engineer.md` frontmatter demonstrates the `capability.planning_step` schema.
- [ ] All unit tests in `planning-step.test.ts` pass.
- [ ] CI mode (`CI=true`) auto-approves plans without human gate.
- [ ] Plans with step count exceeding `max_plan_steps` are rejected at validation with a clear error message.
- [ ] TypeScript compiles with zero errors (`npm run build` in `v3/@claude-flow/hooks`).
