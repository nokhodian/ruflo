# Task 20: TypedDict Swarm State with Reducer Annotations
**Priority:** Phase 3 — Workflows & Optimization  
**Effort:** Medium  
**Depends on:** Task 19 (Task DAG)  
**Blocks:** Task 21 (Workflow DSL)

## 1. Current State

Shared swarm state today is passed as an untyped `Record<string, unknown>` blob through the memory namespace.

| Component | Location | Current Behavior |
|---|---|---|
| Agent config/state | `v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` | `config: z.record(z.unknown())` — fully untyped |
| Memory store | `v3/@claude-flow/memory/src/agent-db.ts` | Key-value with `value: unknown`; no merge semantics |
| Swarm coordination | `v3/mcp/tools/` — coordination tools | Topology and consensus configured, but state shape unspecified |
| Parallel agent output merging | No implementation | Parallel agents overwrite each other's memory keys silently |
| Consensus layer | `v3/mcp/tools/` — Raft/Byzantine/CRDT tools | State objects passed through; no typed reducer applied at handoff |

**Concrete failure mode:** Two parallel agents (B and C, both running at level 1 of a DAG after agent A) write their findings to `swarm:findings`. The second write overwrites the first. One agent's findings are permanently lost with no error.

## 2. Gap Analysis

- No typed `SwarmState` interface — state shape is not enforced at compile time or runtime.
- No per-field reducer declarations — no system knows that `findings` should be appended vs. `lastDecision` should be last-write-wins.
- Parallel agents racing on the same state key silently corrupt data.
- Raft consensus layer has no structured state to merge — it serializes raw JSON blobs.
- No validation that an agent wrote the expected keys before the next DAG level begins.
- No `StateValidator` that checks state invariants at level boundaries.

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/shared/src/swarm-state.ts` | `SwarmState` interface, `SwarmStateField`, built-in reducers |
| `v3/@claude-flow/shared/src/reducers.ts` | Named reducer functions: `appendReducer`, `lastWriteReducer`, `mergeUniqueReducer`, `raftMergeReducer`, `deepMergeReducer` |
| `v3/@claude-flow/shared/src/state-validator.ts` | Validates state keys at DAG level boundaries; reports missing or wrongly-typed fields |
| `v3/@claude-flow/shared/src/state-manager.ts` | Thread-safe merge coordinator; called by DAGExecutor after each level |
| `tests/shared/swarm-state.test.ts` | Unit tests for each reducer and state merge scenarios |

## 4. Files to Modify

| Path | Change | Why |
|---|---|---|
| `v3/@claude-flow/memory/src/agent-db.ts` | Add `mergeState(namespace, key, value, reducer)` method alongside existing `store` | Enables reducer-aware writes that do not clobber parallel agent outputs |
| `v3/mcp/tools/agent-tools.ts` | Replace `config: z.record(z.unknown())` with typed partial `SwarmStateInputSchema` | Compile-time guarantee that agents only write declared keys |
| `v3/@claude-flow/cli/src/workflow/dag-executor.ts` (Task 19) | After each DAG level, call `StateManager.mergeLevel(levelResults)` | Applies reducers before next level begins |
| `v3/@claude-flow/hooks/src/hooks/post-task.ts` | Call `StateManager.applyWrite(taskId, agentOutput, task.stateWriteKeys)` | Hook-level state write with reducer semantics |

## 5. Implementation Steps

1. **Define built-in reducers** — Create `reducers.ts` with five pure functions. Each takes two values of the same type and returns the merged result. No side effects.

2. **Define `SwarmState`** — Create `swarm-state.ts` with the `SwarmStateField<T>` wrapper and the `SwarmState` interface. Export a `DEFAULT_SWARM_STATE` factory function that builds a clean initial state.

3. **Build `StateManager`** — In `state-manager.ts`, implement a class that:
   - Holds the current `SwarmState` in memory
   - Exposes `write(key, value)` — acquires a per-key lock, applies the registered reducer, releases lock
   - Exposes `read(key)` — returns current value
   - Exposes `snapshot()` — returns a deep-frozen copy for checkpointing
   - Exposes `mergeLevel(writes: Array<{key, value, agentId}>)` — batch merge after a parallel DAG level

4. **Add `mergeState` to AgentDB** — Extend `agent-db.ts` with a method that reads the current value for a key, applies the named reducer, and writes back atomically (SQLite transaction).

5. **Build `StateValidator`** — In `state-validator.ts`, implement `validate(state, schema)` that checks:
   - All required keys are present
   - Value types match declared types
   - Returns `ValidationResult` with specific field errors

6. **Wire into DAGExecutor** — After each `Promise.all` level completes, collect all outputs, call `StateManager.mergeLevel`, then call `StateValidator.validate` before proceeding to the next level.

7. **Write tests** — Cover: append reducer (two arrays become one), last-write reducer (second value wins), merge-unique (deduplicates), concurrent writes (simulate 10 parallel writes to same key).

## 6. Key Code Templates

```typescript
// v3/@claude-flow/shared/src/swarm-state.ts

export type ReducerName = 'append' | 'last_write' | 'merge_unique' | 'raft_merge' | 'deep_merge';

export interface SwarmStateField<T> {
  value: T;
  reducer: ReducerName;
  schema?: unknown; // optional Zod/JSON Schema for runtime validation
}

export interface Message {
  id: string;
  fromAgent: string;
  toAgent?: string;
  content: unknown;
  timestamp: Date;
}

export interface Finding {
  agentSlug: string;
  taskId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  file?: string;
  line?: number;
}

export interface AgentError {
  agentSlug: string;
  taskId: string;
  error: string;
  retryCount: number;
  timestamp: Date;
}

export interface ConsensusVote {
  protocol: 'raft' | 'byzantine' | 'gossip';
  term?: number;
  leader?: string;
  votes: Array<{ agentId: string; vote: unknown }>;
  committed: boolean;
}

export interface SwarmState {
  messages:  SwarmStateField<Message[]>;
  findings:  SwarmStateField<Finding[]>;
  errors:    SwarmStateField<AgentError[]>;
  consensus: SwarmStateField<ConsensusVote | null>;
  metadata:  SwarmStateField<Record<string, unknown>>;
  taskResults: SwarmStateField<Record<string, unknown>>;
}

export function createDefaultSwarmState(): SwarmState {
  return {
    messages:    { value: [],   reducer: 'append' },
    findings:    { value: [],   reducer: 'append' },
    errors:      { value: [],   reducer: 'append' },
    consensus:   { value: null, reducer: 'raft_merge' },
    metadata:    { value: {},   reducer: 'deep_merge' },
    taskResults: { value: {},   reducer: 'deep_merge' },
  };
}
```

```typescript
// v3/@claude-flow/shared/src/reducers.ts

export function appendReducer<T>(a: T[], b: T[]): T[] {
  return [...a, ...b];
}

export function lastWriteReducer<T>(_a: T, b: T): T {
  return b;
}

export function mergeUniqueReducer<T>(a: T[], b: T[], key?: keyof T): T[] {
  if (!key) {
    return [...new Set([...a, ...b])];
  }
  const seen = new Set(a.map(item => item[key]));
  const unique = b.filter(item => !seen.has(item[key]));
  return [...a, ...unique];
}

export function deepMergeReducer(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
        typeof result[k] === 'object' && result[k] !== null && !Array.isArray(result[k])) {
      result[k] = deepMergeReducer(
        result[k] as Record<string, unknown>,
        v as Record<string, unknown>
      );
    } else {
      result[k] = v;
    }
  }
  return result;
}

export function raftMergeReducer(
  a: ConsensusVote | null,
  b: ConsensusVote | null
): ConsensusVote | null {
  if (!a) return b;
  if (!b) return a;
  // Higher term wins; if equal, committed wins over pending
  if ((b.term ?? 0) > (a.term ?? 0)) return b;
  if ((b.term ?? 0) === (a.term ?? 0) && b.committed && !a.committed) return b;
  return a;
}

import type { ConsensusVote } from './swarm-state.js';

export const REDUCERS: Record<string, (...args: unknown[]) => unknown> = {
  append:       appendReducer,
  last_write:   lastWriteReducer,
  merge_unique: mergeUniqueReducer,
  deep_merge:   deepMergeReducer,
  raft_merge:   raftMergeReducer,
};
```

```typescript
// v3/@claude-flow/shared/src/state-manager.ts

import { SwarmState, SwarmStateField, createDefaultSwarmState } from './swarm-state.js';
import { REDUCERS } from './reducers.js';

type StateKey = keyof SwarmState;

interface PendingWrite {
  key: StateKey;
  value: unknown;
  agentId: string;
}

export class StateManager {
  private state: SwarmState;
  private locks = new Map<StateKey, Promise<void>>();

  constructor(initialState?: Partial<SwarmState>) {
    this.state = { ...createDefaultSwarmState(), ...initialState };
  }

  async write(key: StateKey, value: unknown, agentId: string): Promise<void> {
    // Serialize writes per key
    const currentLock = this.locks.get(key) ?? Promise.resolve();
    const newLock = currentLock.then(() => {
      const field = this.state[key] as SwarmStateField<unknown>;
      const reducer = REDUCERS[field.reducer];
      if (!reducer) throw new Error(`Unknown reducer: ${field.reducer}`);
      (this.state[key] as SwarmStateField<unknown>).value = reducer(field.value, value);
    });
    this.locks.set(key, newLock);
    await newLock;
  }

  read<K extends StateKey>(key: K): SwarmState[K]['value'] {
    return (this.state[key] as SwarmStateField<unknown>).value as SwarmState[K]['value'];
  }

  async mergeLevel(writes: PendingWrite[]): Promise<void> {
    await Promise.all(writes.map(w => this.write(w.key, w.value, w.agentId)));
  }

  snapshot(): Readonly<SwarmState> {
    return Object.freeze(JSON.parse(JSON.stringify(this.state)));
  }
}
```

```typescript
// v3/@claude-flow/shared/src/state-validator.ts

import { SwarmState } from './swarm-state.js';

export interface StateValidationError {
  key: string;
  expected: string;
  actual: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: StateValidationError[];
}

export function validateSwarmState(
  state: Partial<SwarmState>,
  requiredKeys: Array<keyof SwarmState>
): ValidationResult {
  const errors: StateValidationError[] = [];

  for (const key of requiredKeys) {
    if (!(key in state)) {
      errors.push({ key, expected: 'present', actual: 'missing', message: `Required key "${key}" is absent` });
      continue;
    }
    const field = state[key];
    if (field === undefined || field === null) {
      errors.push({ key, expected: 'SwarmStateField', actual: String(field), message: `Key "${key}" has null value` });
    }
  }

  return { valid: errors.length === 0, errors };
}
```

## 7. Testing Strategy

```typescript
// tests/shared/swarm-state.test.ts

import { appendReducer, lastWriteReducer, mergeUniqueReducer, deepMergeReducer } from '../../v3/@claude-flow/shared/src/reducers.js';
import { StateManager } from '../../v3/@claude-flow/shared/src/state-manager.js';

describe('appendReducer', () => {
  it('concatenates two arrays', () => {
    expect(appendReducer([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
  });
  it('handles empty arrays', () => {
    expect(appendReducer([], [1])).toEqual([1]);
    expect(appendReducer([1], [])).toEqual([1]);
  });
});

describe('lastWriteReducer', () => {
  it('returns the second value', () => {
    expect(lastWriteReducer('old', 'new')).toBe('new');
  });
});

describe('mergeUniqueReducer', () => {
  it('deduplicates primitive arrays', () => {
    expect(mergeUniqueReducer([1, 2], [2, 3])).toEqual([1, 2, 3]);
  });
  it('deduplicates by key for object arrays', () => {
    const a = [{ id: 1, v: 'a' }];
    const b = [{ id: 1, v: 'b' }, { id: 2, v: 'c' }];
    expect(mergeUniqueReducer(a, b, 'id')).toEqual([{ id: 1, v: 'a' }, { id: 2, v: 'c' }]);
  });
});

describe('deepMergeReducer', () => {
  it('deeply merges nested objects', () => {
    const a = { x: { y: 1 }, z: 2 };
    const b = { x: { w: 3 } };
    expect(deepMergeReducer(a, b)).toEqual({ x: { y: 1, w: 3 }, z: 2 });
  });
  it('second value wins for non-object types', () => {
    expect(deepMergeReducer({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });
});

describe('StateManager concurrent writes', () => {
  it('correctly appends 10 parallel writes to findings', async () => {
    const manager = new StateManager();
    const writes = Array.from({ length: 10 }, (_, i) =>
      manager.write('findings', [{ agentSlug: `agent-${i}`, taskId: 't1',
        severity: 'low', description: `finding ${i}` }], `agent-${i}`)
    );
    await Promise.all(writes);
    const findings = manager.read('findings');
    expect(findings).toHaveLength(10);
  });

  it('does not lose writes under concurrent pressure', async () => {
    const manager = new StateManager();
    await Promise.all([
      manager.write('metadata', { a: 1 }, 'agent-1'),
      manager.write('metadata', { b: 2 }, 'agent-2'),
      manager.write('metadata', { c: 3 }, 'agent-3'),
    ]);
    const meta = manager.read('metadata');
    expect(meta).toMatchObject({ a: 1, b: 2, c: 3 });
  });
});
```

## 8. Definition of Done

- [ ] `SwarmState` interface with five typed fields and reducer annotations compiles with `tsc --strict`
- [ ] All five reducer functions (`append`, `last_write`, `merge_unique`, `deep_merge`, `raft_merge`) implemented and covered by unit tests
- [ ] `StateManager.write` serializes concurrent writes per key using promise chaining (no race condition)
- [ ] `StateManager.mergeLevel` applies all reducers after a parallel DAG level completes
- [ ] `StateManager.snapshot()` returns a deep-frozen immutable copy
- [ ] `AgentDB.mergeState` persists reducer-aware writes in a SQLite transaction
- [ ] `StateValidator.validateSwarmState` detects missing required keys with descriptive errors
- [ ] DAGExecutor (Task 19) calls `StateManager.mergeLevel` after each level
- [ ] 10 concurrent writes to the `findings` key produce all 10 findings (verified by test)
- [ ] `tsc --noEmit` passes across all modified and created files
