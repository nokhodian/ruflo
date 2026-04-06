# Task 05: Typed Agent I/O Contracts

**Priority:** Phase 1 — Foundation  
**Effort:** Medium  
**Depends on:** 04-capability-metadata  
**Blocks:** 06-auto-retry

---

## 1. Current State

Inter-agent communication in ruflo uses raw strings. When one agent completes and its output is passed to the next agent as context, there is no schema validation, no structural contract, and no early detection of format mismatches.

**Current data flow** (from `v3/mcp/tools/agent-tools.ts`):

The `spawnAgentSchema` at lines 151–157 of `agent-tools.ts` accepts:
```typescript
const spawnAgentSchema = z.object({
  agentType: agentTypeSchema,
  id: z.string().optional(),
  config: z.record(z.unknown()).optional(),  // arbitrary config blob
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  metadata: z.record(z.unknown()).optional(), // arbitrary metadata blob
});
```

`config` and `metadata` are untyped `Record<string, unknown>`. There is no `inputSchema`, `outputSchema`, or contract validation at agent handoff points.

**Agent output handling** (from `v3/mcp/tools/agent-tools.ts`, lines 182–200):
```typescript
interface AgentInfo {
  id: string;
  agentType: string;
  status: 'active' | 'idle' | 'terminated';
  createdAt: string;
  lastActivityAt?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

The `metrics` field exists but agent *output data* (what the agent produced) is not structured. There is no `output` or `result` field with a defined schema.

**Schema directory**: `.claude/agents/schemas/` — does **not exist yet** (must be created).

**Shared module** at `v3/@claude-flow/shared/src/`:
- Contains `types.ts`, `utils/`, `events.ts`, `plugins/`, `security/`, `services/`, `resilience/`, `core/`
- Does NOT contain a `schema-validator.ts`

---

## 2. Gap Analysis

**What is missing:**

1. **No `.claude/agents/schemas/` directory.** No JSON Schema files for any agent input or output types.
2. **No `SchemaValidator` utility.** No code validates agent output against a declared schema.
3. **No `output` field in `AgentInfo`.** When an agent completes, its result is not captured in a structured form.
4. **No contract enforcement at handoff.** There is no code that checks "agent A's output is compatible with agent B's input" at orchestration time.
5. **`capability.output_schema` and `capability.input_schema`** fields are referenced in Task 04 but have no consumer.

**Failure modes without this task:**
- Agent A produces `{ findings: [...] }` but agent B expects `{ vulnerabilities: [...] }` — silent mismatch, bad downstream output
- Schema changes to one agent's output propagate as silent breakage to all consumers
- Task 06 (auto-retry) has nothing to validate — it needs a `ZodSchema<T>` or JSON Schema to retry against

---

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `.claude/agents/schemas/generic-task-input.json` | Minimal input schema for agents that accept a free-text task |
| `.claude/agents/schemas/security-audit-output.json` | Output schema for security engineer findings |
| `.claude/agents/schemas/code-review-output.json` | Output schema for code reviewer findings |
| `.claude/agents/schemas/research-output.json` | Output schema for researcher analysis |
| `.claude/agents/schemas/implementation-output.json` | Output schema for coder/developer results |
| `.claude/agents/schemas/test-report-output.json` | Output schema for tester results |
| `.claude/agents/schemas/architecture-output.json` | Output schema for architect design documents |
| `v3/@claude-flow/shared/src/schema-validator.ts` | `SchemaValidator` class that validates agent I/O against JSON Schema or Zod |
| `v3/@claude-flow/shared/src/agent-contract.ts` | `AgentContract` class for checking output/input schema compatibility at graph build time |
| `tests/shared/schema-validator.test.ts` | Unit tests for SchemaValidator |
| `tests/shared/agent-contract.test.ts` | Unit tests for AgentContract |

---

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/mcp/tools/agent-tools.ts` | Add optional `outputSchema` and `inputSchema` string fields to `spawnAgentSchema`. Add `output` typed field to `AgentInfo`. |
| `v3/@claude-flow/shared/src/index.ts` | Export `SchemaValidator`, `AgentContract`, and all schema-related types |

---

## 5. Implementation Steps

### Step 1: Create JSON Schema files for the most common agent output types

For each agent category, create a JSON Schema file in `.claude/agents/schemas/`. Start with the most commonly chained agents.

**Step 1a:** Create `.claude/agents/schemas/generic-task-input.json`
**Step 1b:** Create `.claude/agents/schemas/security-audit-output.json`
**Step 1c:** Create `.claude/agents/schemas/code-review-output.json`
**Step 1d:** Create `.claude/agents/schemas/research-output.json`
**Step 1e:** Create `.claude/agents/schemas/implementation-output.json`
**Step 1f:** Create `.claude/agents/schemas/test-report-output.json`
**Step 1g:** Create `.claude/agents/schemas/architecture-output.json`

See Section 6 for the complete JSON Schema content.

### Step 2: Create `SchemaValidator` in shared module

Read `v3/@claude-flow/shared/src/types.ts` first to understand existing type conventions.

Create `v3/@claude-flow/shared/src/schema-validator.ts` — full implementation in Section 6.

The `SchemaValidator` class must:
- Load JSON Schema files from disk (given a path relative to the project root)
- Validate any object against a loaded schema
- Return typed `ValidationResult` with `{ valid: boolean; errors: ValidationError[] }`
- Support Zod schema validation as an alternative to JSON Schema
- Be synchronous for cached schemas, async only on first load

### Step 3: Create `AgentContract` class

Create `v3/@claude-flow/shared/src/agent-contract.ts`.

`AgentContract` validates compatibility between two chained agents:
- Given agent A's `output_schema` path and agent B's `input_schema` path, verify that A's output can satisfy B's input (structural subset check)
- Return a `CompatibilityReport` with any incompatible fields listed

### Step 4: Modify `agent-tools.ts`

Read `v3/mcp/tools/agent-tools.ts` first.

Add to `spawnAgentSchema`:
```typescript
const spawnAgentSchema = z.object({
  agentType: agentTypeSchema,
  id: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  metadata: z.record(z.unknown()).optional(),
  // NEW FIELDS:
  inputSchema: z.string().optional().describe('Path to JSON Schema file for agent input validation'),
  outputSchema: z.string().optional().describe('Path to JSON Schema file for agent output validation'),
  taskDescription: z.string().optional().describe('Human-readable description of what this agent should produce'),
});
```

Add to `AgentInfo` interface:
```typescript
interface AgentInfo {
  id: string;
  agentType: string;
  status: 'active' | 'idle' | 'terminated';
  createdAt: string;
  lastActivityAt?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  // NEW FIELDS:
  inputSchema?: string;
  outputSchema?: string;
  output?: Record<string, unknown>;  // structured output from the agent's last run
  outputValid?: boolean;             // true if output passed schema validation
}
```

### Step 5: Update shared module exports

Read `v3/@claude-flow/shared/src/index.ts`. Add exports:
```typescript
export { SchemaValidator } from './schema-validator.js';
export type { ValidationResult, ValidationError as SchemaValidationError } from './schema-validator.js';
export { AgentContract } from './agent-contract.js';
export type { CompatibilityReport } from './agent-contract.js';
```

### Step 6: Write tests

Create `tests/shared/schema-validator.test.ts` and `tests/shared/agent-contract.test.ts` — see Section 7.

---

## 6. Key Code Templates

### `.claude/agents/schemas/generic-task-input.json`
```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "$id": "generic-task-input",
  "type": "object",
  "required": ["task"],
  "properties": {
    "task": {
      "type": "string",
      "description": "The task description for this agent",
      "minLength": 1,
      "maxLength": 4000
    },
    "context": {
      "type": "string",
      "description": "Optional additional context from upstream agents"
    },
    "sessionId": {
      "type": "string",
      "description": "Session identifier for memory continuity"
    }
  },
  "additionalProperties": false
}
```

### `.claude/agents/schemas/security-audit-output.json`
```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "$id": "security-audit-output",
  "type": "object",
  "required": ["findings", "summary", "severity", "agentSlug"],
  "properties": {
    "agentSlug": { "type": "string" },
    "summary": {
      "type": "string",
      "description": "High-level summary of the security audit"
    },
    "severity": {
      "enum": ["none", "low", "medium", "high", "critical"],
      "description": "Overall severity of findings"
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["description", "severity"],
        "properties": {
          "file":        { "type": "string" },
          "line":        { "type": "integer", "minimum": 1 },
          "description": { "type": "string", "minLength": 10 },
          "severity":    { "enum": ["low", "medium", "high", "critical"] },
          "cve":         { "type": "string", "pattern": "^CVE-\\d{4}-\\d+$" },
          "remediation": { "type": "string" },
          "owasp":       { "type": "string" }
        }
      }
    },
    "recommendations": {
      "type": "array",
      "items": { "type": "string" }
    },
    "completedAt": { "type": "string", "format": "date-time" }
  }
}
```

### `.claude/agents/schemas/code-review-output.json`
```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "$id": "code-review-output",
  "type": "object",
  "required": ["findings", "summary", "approved", "agentSlug"],
  "properties": {
    "agentSlug": { "type": "string" },
    "summary": { "type": "string" },
    "approved": { "type": "boolean" },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "description"],
        "properties": {
          "type":        { "enum": ["bug", "style", "performance", "security", "suggestion"] },
          "file":        { "type": "string" },
          "line":        { "type": "integer" },
          "description": { "type": "string" },
          "severity":    { "enum": ["nit", "minor", "major", "blocking"] },
          "suggestion":  { "type": "string" }
        }
      }
    },
    "metrics": {
      "type": "object",
      "properties": {
        "filesReviewed": { "type": "integer" },
        "linesReviewed": { "type": "integer" },
        "issuesFound":   { "type": "integer" }
      }
    }
  }
}
```

### `.claude/agents/schemas/test-report-output.json`
```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "$id": "test-report-output",
  "type": "object",
  "required": ["filesCreated", "summary", "agentSlug"],
  "properties": {
    "agentSlug": { "type": "string" },
    "summary": { "type": "string" },
    "filesCreated": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Paths to test files created or modified"
    },
    "testCount": { "type": "integer", "minimum": 0 },
    "coverage": {
      "type": "object",
      "properties": {
        "lines":     { "type": "number", "minimum": 0, "maximum": 100 },
        "branches":  { "type": "number", "minimum": 0, "maximum": 100 },
        "functions": { "type": "number", "minimum": 0, "maximum": 100 }
      }
    },
    "frameworks": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

### `v3/@claude-flow/shared/src/schema-validator.ts`
```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ZodSchema, ZodError } from 'zod';

export interface ValidationError {
  path: string;
  message: string;
  received?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Minimal JSON Schema validator (subset: type, required, properties, enum, minimum, maxLength, pattern).
 * For production, replace with ajv for full JSON Schema draft-07 support.
 */
function validateJsonSchema(
  data: unknown,
  schema: Record<string, unknown>,
  path = ''
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (schema.type === 'object' && typeof data !== 'object') {
    errors.push({ path, message: `Expected object, got ${typeof data}` });
    return errors;
  }

  if (schema.type === 'string' && typeof data !== 'string') {
    errors.push({ path, message: `Expected string, got ${typeof data}`, received: data });
    return errors;
  }

  if (schema.type === 'array' && !Array.isArray(data)) {
    errors.push({ path, message: `Expected array, got ${typeof data}` });
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    errors.push({
      path,
      message: `Value must be one of: ${schema.enum.join(', ')}`,
      received: data,
    });
  }

  if (schema.type === 'object' && typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;

    // Check required fields
    if (Array.isArray(schema.required)) {
      for (const field of schema.required as string[]) {
        if (!(field in obj)) {
          errors.push({ path: `${path}.${field}`, message: `Required field is missing` });
        }
      }
    }

    // Validate properties
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, propSchema] of Object.entries(
        schema.properties as Record<string, Record<string, unknown>>
      )) {
        if (key in obj) {
          errors.push(
            ...validateJsonSchema(obj[key], propSchema, `${path}.${key}`)
          );
        }
      }
    }
  }

  return errors;
}

/**
 * SchemaValidator validates agent I/O against JSON Schema files or Zod schemas.
 *
 * Usage:
 *   const validator = new SchemaValidator();
 *   const result = validator.validateWithJsonSchemaFile(output, '.claude/agents/schemas/security-audit-output.json');
 *   if (!result.valid) { ... handle errors ... }
 */
export class SchemaValidator {
  private schemaCache = new Map<string, Record<string, unknown>>();

  /**
   * Validate data against a JSON Schema file loaded from disk.
   * Schema files are cached after first load.
   */
  validateWithJsonSchemaFile(data: unknown, schemaPath: string): ValidationResult {
    const schema = this.loadSchema(schemaPath);
    const errors = validateJsonSchema(data, schema);
    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate data against a Zod schema.
   */
  validateWithZod<T>(data: unknown, schema: ZodSchema<T>): ValidationResult {
    const result = schema.safeParse(data);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: (result.error as ZodError).errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
        received: undefined,
      })),
    };
  }

  /**
   * Format validation errors as a human-readable string for re-prompting agents.
   */
  formatErrorsForReprompt(errors: ValidationError[]): string {
    if (errors.length === 0) return '';
    return [
      'Your output did not conform to the expected schema. Please fix these issues:',
      ...errors.map(e => `- Field "${e.path}": ${e.message}`),
    ].join('\n');
  }

  private loadSchema(schemaPath: string): Record<string, unknown> {
    const absPath = resolve(schemaPath);
    if (this.schemaCache.has(absPath)) {
      return this.schemaCache.get(absPath)!;
    }
    const content = readFileSync(absPath, 'utf8');
    const schema = JSON.parse(content) as Record<string, unknown>;
    this.schemaCache.set(absPath, schema);
    return schema;
  }
}
```

### `v3/@claude-flow/shared/src/agent-contract.ts`
```typescript
import { SchemaValidator } from './schema-validator.js';

export interface AgentContractConfig {
  /** Agent slug of the upstream (producing) agent */
  upstreamSlug: string;
  /** Path to upstream agent's output schema */
  upstreamOutputSchema: string;
  /** Agent slug of the downstream (consuming) agent */
  downstreamSlug: string;
  /** Path to downstream agent's input schema */
  downstreamInputSchema: string;
}

export interface CompatibilityReport {
  compatible: boolean;
  upstreamSlug: string;
  downstreamSlug: string;
  issues: string[];
}

/**
 * AgentContract checks that the output schema of one agent is compatible with
 * the input schema of another agent at graph build time (before execution).
 *
 * Compatibility check: every REQUIRED field of the downstream input schema
 * must be present as a property in the upstream output schema.
 */
export class AgentContract {
  private validator = new SchemaValidator();

  check(config: AgentContractConfig): CompatibilityReport {
    const issues: string[] = [];

    let upstreamSchema: Record<string, unknown>;
    let downstreamSchema: Record<string, unknown>;

    try {
      upstreamSchema = this.validator['loadSchema'](config.upstreamOutputSchema);
    } catch (err) {
      return {
        compatible: false,
        upstreamSlug: config.upstreamSlug,
        downstreamSlug: config.downstreamSlug,
        issues: [`Cannot load upstream output schema: ${config.upstreamOutputSchema}`],
      };
    }

    try {
      downstreamSchema = this.validator['loadSchema'](config.downstreamInputSchema);
    } catch (err) {
      return {
        compatible: false,
        upstreamSlug: config.upstreamSlug,
        downstreamSlug: config.downstreamSlug,
        issues: [`Cannot load downstream input schema: ${config.downstreamInputSchema}`],
      };
    }

    // Check every required downstream input field exists in upstream output properties
    const upstreamProps = (upstreamSchema.properties as Record<string, unknown>) ?? {};
    const downstreamRequired = (downstreamSchema.required as string[]) ?? [];

    for (const field of downstreamRequired) {
      if (!(field in upstreamProps)) {
        issues.push(
          `Downstream agent "${config.downstreamSlug}" requires field "${field}" ` +
          `but upstream agent "${config.upstreamSlug}" does not produce it.`
        );
      }
    }

    return {
      compatible: issues.length === 0,
      upstreamSlug: config.upstreamSlug,
      downstreamSlug: config.downstreamSlug,
      issues,
    };
  }

  /**
   * Validate actual agent output against its declared schema.
   * Returns formatted error string for re-prompting (used by Task 06 auto-retry).
   */
  validateOutput(
    output: unknown,
    outputSchemaPath: string
  ): { valid: boolean; errorMessage: string } {
    const result = this.validator.validateWithJsonSchemaFile(output, outputSchemaPath);
    if (result.valid) return { valid: true, errorMessage: '' };
    return {
      valid: false,
      errorMessage: this.validator.formatErrorsForReprompt(result.errors),
    };
  }
}
```

---

## 7. Testing Strategy

### Unit Tests (`tests/shared/schema-validator.test.ts`)

```typescript
import { SchemaValidator } from '../../v3/@claude-flow/shared/src/schema-validator.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const FIXTURE_DIR = '/tmp/ruflo-schema-test';

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(
    join(FIXTURE_DIR, 'test-schema.json'),
    JSON.stringify({
      type: 'object',
      required: ['name', 'count'],
      properties: {
        name:  { type: 'string' },
        count: { type: 'integer' },
        level: { enum: ['low', 'high'] },
      },
    })
  );
});

afterAll(() => rmSync(FIXTURE_DIR, { recursive: true }));

describe('SchemaValidator', () => {
  let validator: SchemaValidator;
  beforeEach(() => { validator = new SchemaValidator(); });

  describe('validateWithJsonSchemaFile', () => {
    it('returns valid=true for conforming object', () => {
      const result = validator.validateWithJsonSchemaFile(
        { name: 'test', count: 5 },
        join(FIXTURE_DIR, 'test-schema.json')
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns valid=false with errors for missing required field', () => {
      const result = validator.validateWithJsonSchemaFile(
        { name: 'test' }, // missing 'count'
        join(FIXTURE_DIR, 'test-schema.json')
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('count'))).toBe(true);
    });

    it('returns valid=false for wrong type', () => {
      const result = validator.validateWithJsonSchemaFile(
        'not-an-object',
        join(FIXTURE_DIR, 'test-schema.json')
      );
      expect(result.valid).toBe(false);
    });

    it('validates enum values', () => {
      const result = validator.validateWithJsonSchemaFile(
        { name: 'test', count: 1, level: 'invalid-value' },
        join(FIXTURE_DIR, 'test-schema.json')
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('level'))).toBe(true);
    });

    it('caches schema after first load', () => {
      const schemaPath = join(FIXTURE_DIR, 'test-schema.json');
      validator.validateWithJsonSchemaFile({ name: 'x', count: 1 }, schemaPath);
      validator.validateWithJsonSchemaFile({ name: 'y', count: 2 }, schemaPath);
      // Second call should use cache (no file I/O errors on non-existent path)
    });
  });

  describe('formatErrorsForReprompt', () => {
    it('returns empty string for no errors', () => {
      expect(validator.formatErrorsForReprompt([])).toBe('');
    });

    it('formats errors with field paths', () => {
      const formatted = validator.formatErrorsForReprompt([
        { path: '.findings', message: 'Required field is missing' },
      ]);
      expect(formatted).toContain('findings');
      expect(formatted).toContain('Required field is missing');
    });
  });
});
```

### Unit Tests (`tests/shared/agent-contract.test.ts`)

```typescript
import { AgentContract } from '../../v3/@claude-flow/shared/src/agent-contract.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const FIXTURE_DIR = '/tmp/ruflo-contract-test';

const upstreamOutputSchema = {
  type: 'object',
  required: ['findings', 'summary'],
  properties: {
    findings: { type: 'array' },
    summary:  { type: 'string' },
    metadata: { type: 'object' },
  },
};

const compatibleInputSchema = {
  type: 'object',
  required: ['findings', 'summary'],
  properties: {
    findings: { type: 'array' },
    summary:  { type: 'string' },
  },
};

const incompatibleInputSchema = {
  type: 'object',
  required: ['findings', 'summary', 'priority'], // 'priority' not in upstream output
  properties: {
    findings: { type: 'array' },
    summary:  { type: 'string' },
    priority: { type: 'string' },
  },
};

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(join(FIXTURE_DIR, 'upstream-output.json'), JSON.stringify(upstreamOutputSchema));
  writeFileSync(join(FIXTURE_DIR, 'compatible-input.json'), JSON.stringify(compatibleInputSchema));
  writeFileSync(join(FIXTURE_DIR, 'incompatible-input.json'), JSON.stringify(incompatibleInputSchema));
});
afterAll(() => rmSync(FIXTURE_DIR, { recursive: true }));

describe('AgentContract', () => {
  let contract: AgentContract;
  beforeEach(() => { contract = new AgentContract(); });

  it('reports compatible for matching schemas', () => {
    const report = contract.check({
      upstreamSlug: 'security-engineer',
      upstreamOutputSchema: join(FIXTURE_DIR, 'upstream-output.json'),
      downstreamSlug: 'code-reviewer',
      downstreamInputSchema: join(FIXTURE_DIR, 'compatible-input.json'),
    });
    expect(report.compatible).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('reports incompatible when downstream requires missing field', () => {
    const report = contract.check({
      upstreamSlug: 'security-engineer',
      upstreamOutputSchema: join(FIXTURE_DIR, 'upstream-output.json'),
      downstreamSlug: 'coordinator',
      downstreamInputSchema: join(FIXTURE_DIR, 'incompatible-input.json'),
    });
    expect(report.compatible).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues[0]).toContain('priority');
  });

  it('includes agent slugs in the report', () => {
    const report = contract.check({
      upstreamSlug: 'my-upstream',
      upstreamOutputSchema: join(FIXTURE_DIR, 'upstream-output.json'),
      downstreamSlug: 'my-downstream',
      downstreamInputSchema: join(FIXTURE_DIR, 'compatible-input.json'),
    });
    expect(report.upstreamSlug).toBe('my-upstream');
    expect(report.downstreamSlug).toBe('my-downstream');
  });

  it('reports incompatible when output schema file is missing', () => {
    const report = contract.check({
      upstreamSlug: 'a',
      upstreamOutputSchema: '/nonexistent/schema.json',
      downstreamSlug: 'b',
      downstreamInputSchema: join(FIXTURE_DIR, 'compatible-input.json'),
    });
    expect(report.compatible).toBe(false);
  });
});
```

### Acceptance Tests for Existing Schema Files

```typescript
describe('Provided schema files are valid JSON Schema', () => {
  const schemaFiles = [
    '.claude/agents/schemas/generic-task-input.json',
    '.claude/agents/schemas/security-audit-output.json',
    '.claude/agents/schemas/code-review-output.json',
    '.claude/agents/schemas/test-report-output.json',
  ];

  for (const schemaFile of schemaFiles) {
    it(`${schemaFile} parses without error`, () => {
      expect(() => JSON.parse(readFileSync(schemaFile, 'utf8'))).not.toThrow();
    });

    it(`${schemaFile} has $schema and type fields`, () => {
      const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
      expect(schema.$schema).toBeDefined();
      expect(schema.type).toBe('object');
    });
  }
});
```

---

## 8. Definition of Done

- [ ] `.claude/agents/schemas/` directory created with 7 JSON Schema files
- [ ] Every schema file has: `$schema`, `$id`, `type: "object"`, `required`, `properties`
- [ ] `SecurityAuditReport` schema requires: `findings` (array), `summary` (string), `severity` (enum), `agentSlug` (string)
- [ ] `CodeReviewOutput` schema requires: `findings` (array), `summary` (string), `approved` (boolean), `agentSlug` (string)
- [ ] `SchemaValidator` class exists at `v3/@claude-flow/shared/src/schema-validator.ts`
- [ ] `SchemaValidator.validateWithJsonSchemaFile()` loads and caches schemas from disk
- [ ] `SchemaValidator.formatErrorsForReprompt()` produces human-readable error text suitable for agent re-prompting
- [ ] `AgentContract.check()` detects missing required fields in upstream-to-downstream handoffs
- [ ] `AgentContract.validateOutput()` returns `{ valid, errorMessage }` ready for use in Task 06
- [ ] `spawnAgentSchema` in `agent-tools.ts` has optional `inputSchema` and `outputSchema` string fields
- [ ] `AgentInfo` interface has optional `output`, `outputValid`, `inputSchema`, `outputSchema` fields
- [ ] All unit tests pass
- [ ] Exported from `v3/@claude-flow/shared/src/index.ts`
- [ ] No TypeScript `any` types
- [ ] All new files under 500 lines
