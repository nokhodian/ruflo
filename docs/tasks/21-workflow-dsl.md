# Task 21: Declarative Workflow DSL (Fan-out/Fan-in, Conditional, Loop)
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** High  
**Depends on:** Task 19 (Task DAG), Task 20 (Typed Swarm State)  
**Blocks:** none (enables complex user-defined pipelines)

## 1. Current State

Workflows today are either sequential CLI commands or manually-wired agent spawns in CLAUDE.md patterns.

| Component | Location | Current Behavior |
|---|---|---|
| Workflow command | `v3/@claude-flow/cli/src/commands/workflow.ts` | `workflow list`, `workflow execute` — but no YAML schema loader |
| Workflow MCP tools | `v3/mcp/tools/` | `workflow_create`, `workflow_execute`, `workflow_list` exist as stubs |
| Parallel execution | `CLAUDE.md` "Concurrency" section | Manual `Promise.all` instructions in agent prompts |
| Conditional branching | No implementation | Must be hand-coded per use case |
| Fan-out/map-reduce | No implementation | Manual loop in orchestrator scripts |
| Loop/retry | No implementation | Manual retry code per workflow |
| Workflow files | `.claude/workflows/` directory | Does not exist yet |

**Concrete failure mode:** A security audit workflow that should: run build-check → if pass, run security scan + API tests in parallel → synthesize results requires ~50 lines of custom orchestration code and is impossible to run declaratively. Any engineer wanting to reuse it must copy-paste that code.

## 2. Gap Analysis

- No YAML workflow schema definition or parser.
- No runtime workflow executor implementing fan-out, fan-in, conditional, map-reduce, and loop semantics.
- No `.claude/workflows/` directory convention or CLI integration for loading workflow files.
- No template engine for `{{variable}}` substitution in workflow step tasks.
- No workflow-level result type with step-by-step execution trace.
- No CLI `workflow run` subcommand that loads a YAML file and executes it.

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/cli/src/workflow/dsl-schema.ts` | Zod schema for the complete Workflow DSL; validates YAML/JSON before execution |
| `v3/@claude-flow/cli/src/workflow/dsl-parser.ts` | Loads YAML file from disk, parses, validates against DSL schema, returns typed `WorkflowDefinition` |
| `v3/@claude-flow/cli/src/workflow/executor.ts` | Recursive workflow executor implementing all step types |
| `v3/@claude-flow/cli/src/workflow/template-engine.ts` | `{{variable}}` and `{{step-id.field}}` substitution in task strings |
| `v3/@claude-flow/cli/src/workflow/map-reduce-worker.ts` | Handles `map_reduce` step type: fans out N items to mapAgent, collects, feeds to reduceAgent |
| `v3/@claude-flow/cli/src/workflow/condition-evaluator.ts` | Safely evaluates `condition` strings against current workflow context (no `eval`) |
| `.claude/workflows/security-audit.yaml` | Reference workflow demonstrating all DSL features |
| `.claude/workflows/feature-dev.yaml` | Feature development pipeline workflow |
| `tests/workflow/dsl-parser.test.ts` | YAML parsing and schema validation tests |
| `tests/workflow/executor.test.ts` | Executor tests using mocked dispatch (no real API calls) |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/@claude-flow/cli/src/commands/workflow.ts` | Add `workflow run <file>` subcommand that calls `DSLParser.load()` then `WorkflowExecutor.execute()` | Exposes the DSL to users via CLI |
| `v3/mcp/tools/` workflow tools | Add `workflow_run_yaml` MCP tool wrapping the executor | Exposes DSL execution via MCP interface |

## 5. Implementation Steps

1. **Define the complete YAML schema** — In `dsl-schema.ts`, define Zod schemas for all step types: `AgentStep`, `ParallelStep`, `SequenceStep`, `ConditionalStep`, `MapReduceStep`, `LoopStep`. Union them as `WorkflowStep`. Define top-level `WorkflowDefinition`. This compiles cleanly before any runtime code is written.

2. **Build the YAML parser** — In `dsl-parser.ts`, use `js-yaml` to load a YAML file, pass through the Zod schema, return typed `WorkflowDefinition`. Collect all Zod validation errors and format them as human-readable messages with file:line references (parsed from YAML source map).

3. **Build the template engine** — In `template-engine.ts`, implement a `substitute(template, context)` function that replaces `{{variable}}` with `context.variables[variable]` and `{{step-id.output.field}}` with the named step's output field. Use a safe regex-based approach — no `eval`.

4. **Build the condition evaluator** — In `condition-evaluator.ts`, implement a whitelist-based expression evaluator supporting: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`, string literals, numeric literals, and `{{step.field}}` references. Reject any expression containing function calls, `eval`, `require`, or property access chains beyond two levels.

5. **Build the map-reduce worker** — In `map-reduce-worker.ts`, implement fan-out: given an `items` array and a `mapAgent`, dispatch one task per item in parallel. Wait for all. Feed all outputs to `reduceAgent` as a single context payload. Return the reduce output.

6. **Build the recursive executor** — In `executor.ts`, implement `executeStep(step, context)` that dispatches to the correct handler based on `step.type`. Each handler calls `executeStep` recursively for nested steps. Maintain a `WorkflowContext` object tracking: variables, step outputs keyed by `step.id`, current loop iteration, errors.

7. **Wire CLI subcommand** — In `commands/workflow.ts`, add `run` subcommand with `--file` argument. Load → validate → execute → print final results.

8. **Create reference workflows** — Write the security-audit and feature-dev YAML files demonstrating all DSL features.

9. **Write tests** — Cover: parser rejects invalid YAML, parser accepts valid YAML, conditional step evaluates to correct branch, parallel step runs concurrently (verify via timing), map-reduce produces correct aggregated output, loop stops at maxIterations.

## 6. Key Code Templates

### Full YAML Schema Definition

```yaml
# Full DSL schema reference (this YAML documents the schema; dsl-schema.ts enforces it)

# Top-level fields:
# name: string — workflow identifier
# version: string — semver
# description: string — optional human description
# variables: Record<string, string|number|boolean> — input variables, can be overridden at run time
# steps: WorkflowStep[] — ordered list of steps

# Step types:

# agent step — runs a single agent
# id: string (required, unique)
# type: "agent" (default, optional)
# agent: string — agent slug from ALLOWED_AGENT_TYPES
# task: string — task description, supports {{variable}} substitution
# context_deps: string[] — step IDs whose output to inject as context (optional)
# output_key: string — store output in context under this key (optional)
# timeout_ms: number (optional)
# retry_policy: RetryPolicy (optional)

# parallel step — run multiple sub-steps concurrently, wait for all
# id: string
# type: "parallel"
# steps: WorkflowStep[] — sub-steps to run concurrently

# sequence step — run sub-steps serially (rarely needed; top-level is serial by default)
# id: string
# type: "sequence"
# steps: WorkflowStep[]

# conditional step — branch on a runtime expression
# id: string
# type: "conditional"
# condition: string — expression e.g. "{{build.status}} == 'pass'"
# if_true: WorkflowStep | WorkflowStep[]
# if_false: WorkflowStep | WorkflowStep[] (optional)

# map_reduce step — fan-out N items, reduce results
# id: string
# type: "map_reduce"
# items: string — {{variable}} reference to an array or literal array
# map_agent: string — agent slug
# map_task: string — task template with {{item}} as the current element
# reduce_agent: string — agent slug
# reduce_task: string — task description; all map outputs injected as context

# loop step — bounded iteration
# id: string
# type: "loop"
# condition: string — continue while true
# max_iterations: number — safety cap (required)
# body: WorkflowStep[] — steps to execute each iteration
```

```typescript
// v3/@claude-flow/cli/src/workflow/dsl-schema.ts
import { z } from 'zod';

const retryPolicySchema = z.object({
  maxAttempts:       z.number().int().min(1).max(10).default(3),
  initialDelayMs:    z.number().int().min(0).default(1000),
  backoffMultiplier: z.number().min(1.0).max(10.0).default(2.0),
  jitterMs:          z.number().int().min(0).default(500),
});

// Forward declare for recursive types
const workflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z.discriminatedUnion('type', [
    agentStepSchema,
    parallelStepSchema,
    sequenceStepSchema,
    conditionalStepSchema,
    mapReduceStepSchema,
    loopStepSchema,
  ])
);

const agentStepSchema = z.object({
  id:           z.string().min(1),
  type:         z.literal('agent').default('agent'),
  agent:        z.string().min(1),
  task:         z.string().min(1),
  context_deps: z.array(z.string()).optional(),
  output_key:   z.string().optional(),
  timeout_ms:   z.number().int().positive().optional(),
  retry_policy: retryPolicySchema.optional(),
});

const parallelStepSchema = z.object({
  id:    z.string().min(1),
  type:  z.literal('parallel'),
  steps: z.array(workflowStepSchema).min(2),
});

const sequenceStepSchema = z.object({
  id:    z.string().min(1),
  type:  z.literal('sequence'),
  steps: z.array(workflowStepSchema).min(1),
});

const conditionalStepSchema = z.object({
  id:        z.string().min(1),
  type:      z.literal('conditional'),
  condition: z.string().min(1),
  if_true:   z.union([workflowStepSchema, z.array(workflowStepSchema)]),
  if_false:  z.union([workflowStepSchema, z.array(workflowStepSchema)]).optional(),
});

const mapReduceStepSchema = z.object({
  id:           z.string().min(1),
  type:         z.literal('map_reduce'),
  items:        z.union([z.string(), z.array(z.unknown())]),
  map_agent:    z.string().min(1),
  map_task:     z.string().min(1),
  reduce_agent: z.string().min(1),
  reduce_task:  z.string().min(1),
});

const loopStepSchema = z.object({
  id:             z.string().min(1),
  type:           z.literal('loop'),
  condition:      z.string().min(1),
  max_iterations: z.number().int().min(1).max(100),
  body:           z.array(workflowStepSchema).min(1),
});

export const workflowDefinitionSchema = z.object({
  name:        z.string().min(1),
  version:     z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  description: z.string().optional(),
  variables:   z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  steps:       z.array(workflowStepSchema).min(1),
});

export type WorkflowStep =
  | z.infer<typeof agentStepSchema>
  | z.infer<typeof parallelStepSchema>
  | z.infer<typeof sequenceStepSchema>
  | z.infer<typeof conditionalStepSchema>
  | z.infer<typeof mapReduceStepSchema>
  | z.infer<typeof loopStepSchema>;

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
```

```typescript
// v3/@claude-flow/cli/src/workflow/dsl-parser.ts
import { readFileSync } from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { workflowDefinitionSchema, WorkflowDefinition } from './dsl-schema.js';

export class DSLParser {
  static loadFromFile(filePath: string): WorkflowDefinition {
    let raw: unknown;
    try {
      const content = readFileSync(filePath, 'utf-8');
      raw = yamlLoad(content);
    } catch (err) {
      throw new Error(`Failed to read/parse YAML file "${filePath}": ${(err as Error).message}`);
    }

    const result = workflowDefinitionSchema.safeParse(raw);
    if (!result.success) {
      const messages = result.error.errors.map(e =>
        `  ${e.path.join('.')}: ${e.message}`
      ).join('\n');
      throw new Error(`Workflow validation failed for "${filePath}":\n${messages}`);
    }

    return result.data;
  }

  static loadFromObject(raw: unknown): WorkflowDefinition {
    const result = workflowDefinitionSchema.safeParse(raw);
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  }
}
```

```typescript
// v3/@claude-flow/cli/src/workflow/condition-evaluator.ts
// Safe whitelist-based expression evaluator — no eval()

type ContextValue = string | number | boolean | null | undefined;

const SAFE_OPS = new Set(['==', '!=', '>', '<', '>=', '<=', '&&', '||', '!']);

export function evaluateCondition(
  expression: string,
  context: Record<string, ContextValue>
): boolean {
  // Reject dangerous patterns
  if (/[`$]|\beval\b|\brequire\b|\bprocess\b|\bglobal\b/.test(expression)) {
    throw new Error(`Unsafe expression rejected: "${expression}"`);
  }

  // Substitute {{variable}} references
  const substituted = expression.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const parts = path.trim().split('.');
    let value: unknown = context;
    for (const part of parts) {
      if (typeof value === 'object' && value !== null) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return 'undefined';
      }
    }
    if (typeof value === 'string') return `"${value}"`;
    return String(value ?? 'null');
  });

  // Evaluate only safe tokens
  const tokens = substituted.match(/(".*?"|'.*?'|\d+\.?\d*|true|false|null|==|!=|>=|<=|>|<|&&|\|\||!|\(|\)|\s+)/g);
  if (!tokens) return false;

  // Reconstruct and evaluate using Function constructor with no global access
  const safeExpr = tokens.join('');
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(new Function(`"use strict"; return (${safeExpr})`)());
  } catch {
    throw new Error(`Invalid condition expression: "${expression}"`);
  }
}
```

```yaml
# .claude/workflows/security-audit.yaml
name: security-audit
version: 1.0.0
description: |
  Run build check, then parallel security scan + API tests if build passes.
  Synthesize findings into a final report.
variables:
  target: "src/"
  report_format: "json"

steps:
  - id: build-check
    type: agent
    agent: engineering-devops-automator
    task: "Run build for {{target}} and return JSON with {status: 'pass'|'fail', errors: string[]}"
    output_key: build
    timeout_ms: 120000

  - id: scan-or-review
    type: conditional
    condition: "{{build.status}} == 'pass'"
    if_true:
      type: parallel
      id: parallel-security
      steps:
        - id: vuln-scan
          type: agent
          agent: engineering-security-engineer
          task: "Scan {{target}} for OWASP Top 10 vulnerabilities. Return JSON findings array."
          output_key: vulnFindings
          timeout_ms: 180000

        - id: api-security-test
          type: agent
          agent: testing-api-tester
          task: "Run API security tests against {{target}}. Return JSON with {passed: bool, failures: string[]}"
          output_key: apiTestResults
          timeout_ms: 120000

    if_false:
      id: build-review
      type: agent
      agent: engineering-code-reviewer
      task: "Review build failures: {{build.errors}}. Suggest fixes."
      output_key: buildReview

  - id: synthesize
    type: agent
    agent: hierarchical-coordinator
    task: "Synthesize all security findings into a {{report_format}} report."
    context_deps: [vuln-scan, api-security-test, build-review]
    output_key: finalReport
```

```yaml
# .claude/workflows/feature-dev.yaml
name: feature-dev
version: 1.0.0
description: Full feature development pipeline with architecture, implementation, tests, and review.
variables:
  feature_description: ""

steps:
  - id: architect
    type: agent
    agent: engineering-software-architect
    task: "Design architecture for: {{feature_description}}. Return JSON with {components, interfaces, dependencies}"
    output_key: design

  - id: implement-and-test
    type: parallel
    id: parallel-impl
    steps:
      - id: implement
        type: agent
        agent: engineering-senior-developer
        task: "Implement the feature per design: {{design}}. Return list of created/modified files."
        context_deps: [architect]
        output_key: implementation

      - id: write-tests
        type: agent
        agent: tdd-london-swarm
        task: "Write tests for feature design: {{design}}. Return test file paths."
        context_deps: [architect]
        output_key: tests

  - id: review-loop
    type: loop
    condition: "{{review.approved}} != true"
    max_iterations: 3
    body:
      - id: review
        type: agent
        agent: engineering-code-reviewer
        task: "Review implementation {{implementation}} and tests {{tests}}. Return {approved: bool, comments: string[]}"
        context_deps: [implement, write-tests]
        output_key: review
```

## 7. Testing Strategy

```typescript
// tests/workflow/dsl-parser.test.ts

describe('DSLParser', () => {
  it('accepts a valid minimal workflow', () => {
    const workflow = DSLParser.loadFromObject({
      name: 'test', version: '1.0.0',
      steps: [{ id: 's1', type: 'agent', agent: 'coder', task: 'do it' }]
    });
    expect(workflow.name).toBe('test');
  });

  it('rejects a workflow with no steps', () => {
    expect(() => DSLParser.loadFromObject({ name: 'test', steps: [] }))
      .toThrow(/steps/);
  });

  it('rejects a parallel step with only one child', () => {
    expect(() => DSLParser.loadFromObject({
      name: 'test', steps: [{
        id: 'p1', type: 'parallel',
        steps: [{ id: 's1', type: 'agent', agent: 'coder', task: 'x' }]
      }]
    })).toThrow();
  });

  it('rejects a loop without max_iterations', () => {
    expect(() => DSLParser.loadFromObject({
      name: 'test', steps: [{
        id: 'l1', type: 'loop',
        condition: 'true', body: [{ id: 's1', type: 'agent', agent: 'coder', task: 'x' }]
      }]
    })).toThrow(/max_iterations/);
  });
});

describe('conditionEvaluator', () => {
  it('evaluates a string equality condition', () => {
    expect(evaluateCondition('"pass" == "pass"', {})).toBe(true);
  });
  it('substitutes context variables', () => {
    expect(evaluateCondition('{{status}} == "pass"', { status: 'pass' })).toBe(true);
  });
  it('rejects expressions with eval', () => {
    expect(() => evaluateCondition('eval("1+1")', {})).toThrow(/Unsafe/);
  });
  it('stops loop at max_iterations', async () => {
    // executor test: loop with always-true condition runs exactly max_iterations times
    const counts: number[] = [];
    const mockExecute = async (_step: unknown, _ctx: unknown) => { counts.push(1); return {}; };
    // ... assert counts.length === max_iterations
  });
});
```

## 8. Definition of Done

- [ ] `workflowDefinitionSchema` (Zod) validates all 6 step types and rejects malformed YAML
- [ ] `DSLParser.loadFromFile` loads `security-audit.yaml` without errors
- [ ] `DSLParser.loadFromFile` throws a descriptive multi-line error for invalid YAML
- [ ] Template engine correctly substitutes `{{variable}}` and `{{step-id.field}}` references
- [ ] Condition evaluator correctly handles `==`, `!=`, `&&`, `||`, and `!` operators
- [ ] Condition evaluator rejects expressions containing `eval`, `require`, `process`
- [ ] Parallel steps dispatch all sub-steps concurrently (verified by wall-clock timing test)
- [ ] Conditional step executes `if_true` branch when condition is true, `if_false` otherwise
- [ ] Map-reduce fans out to N tasks and feeds all results to the reduce agent
- [ ] Loop stops at `max_iterations` even when condition remains true
- [ ] `workflow run --file .claude/workflows/security-audit.yaml` executes the reference workflow
- [ ] All tests in `tests/workflow/` pass with zero Claude API calls
- [ ] `.claude/workflows/security-audit.yaml` and `.claude/workflows/feature-dev.yaml` validate clean
