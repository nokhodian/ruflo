# Task 46: Per-Agent Runtime Sandboxing

**Priority:** Phase 5 — Future
**Effort:** High
**Depends on:** (none — standalone security feature; Docker and WASM runtimes are independent of other tasks)
**Blocks:** Task 47 (Dynamic Agent Synthesis — ephemeral synthesized agents MUST run sandboxed; sandboxing is a prerequisite for safely executing auto-generated agent code)

---

## 1. Current State

All ruflo agents with shell access (`Bash` tool) share the host environment. There is no runtime isolation between agents, no resource capping, and no network restriction. The `sandbox` frontmatter field does not exist.

Relevant files:

- `/Users/morteza/Desktop/tools/ruflo/.claude/agents/specialized/lsp-index-engineer.md` — example agent frontmatter; no `sandbox` or `sandbox_config` fields.
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/agent-tools.ts` — `spawnAgentSchema` (line 152) has no sandbox-related fields. `handleSpawnAgent` (line 236) does not provision any isolated runtime before running an agent.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/security/` — security module; has input validation and path security but no runtime container provisioning.
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/hooks/src/workers/` — worker system; no `SandboxWorker` or container lifecycle management.
- No `Dockerfile` or container specification exists in the ruflo agent system.

---

## 2. Gap Analysis

**What is missing:**

1. No `sandbox` frontmatter field — agents have no declared isolation requirement.
2. No `SandboxProvisioner` — no code to create/start/stop Docker containers or WASM runtimes.
3. No `DockerSandbox` implementation — no container configuration, volume mounting, or network policy enforcement.
4. No `WasmSandbox` implementation — no WASM runtime wrapper for lightweight isolation.
5. No resource enforcement — agents can consume unlimited CPU, memory, and disk.
6. No path allowlist — agents can write outside their declared workspace.
7. `spawnAgentSchema` cannot accept sandbox configuration at spawn time.
8. No sandbox lifecycle hooks — containers are not cleaned up after agent termination.

**Concrete failure modes:**

- An agent running a code-execution task deletes files outside the expected workspace (`/workspace`), corrupting the host system.
- Two concurrent agents competing for the same port on the host create networking conflicts and silent failures.
- A security-auditor agent scanning for vulnerabilities inadvertently exploits one during its own scan due to no isolation.
- Auto-synthesized ephemeral agents (Task 47) execute arbitrary generated system prompts with `Bash` access on the host — catastrophic risk without sandboxing.
- Resource exhaustion: an agent with `Bash` access starts a background process that consumes all available RAM.

---

## 3. Files to Create

| Path | Purpose |
|---|---|
| `v3/@claude-flow/security/src/sandbox/sandbox-provisioner.ts` | `SandboxProvisioner` — factory that creates the correct sandbox based on `sandbox` field value |
| `v3/@claude-flow/security/src/sandbox/docker-sandbox.ts` | `DockerSandbox` — Docker container lifecycle management |
| `v3/@claude-flow/security/src/sandbox/wasm-sandbox.ts` | `WasmSandbox` — WASM runtime wrapper (lightweight alternative) |
| `v3/@claude-flow/security/src/sandbox/types.ts` | `SandboxConfig`, `SandboxRuntime`, `SandboxResult` types + frontmatter schema |
| `v3/@claude-flow/security/src/sandbox/sandbox-registry.ts` | Tracks active sandboxes; enforces cleanup on agent termination |
| `v3/@claude-flow/security/src/sandbox/index.ts` | Barrel export |
| `v3/@claude-flow/security/src/__tests__/sandbox.test.ts` | Unit + integration tests |
| `v3/@claude-flow/security/src/sandbox/Dockerfile.agent` | Base Dockerfile for agent sandboxes |

---

## 4. Files to Modify

| Path | Change |
|---|---|
| `v3/mcp/tools/agent-tools.ts` | Add `sandbox_config` object to `spawnAgentSchema`. In `handleSpawnAgent`, call `SandboxProvisioner.provision(agentId, input.sandbox_config)` before running any agent tools. Store sandbox handle in agent context. |
| `v3/mcp/tools/agent-tools.ts` (terminate handler) | In `handleTerminateAgent`, call `SandboxRegistry.cleanup(agentId)` to stop and remove the container/runtime. |
| `.claude/agents/specialized/lsp-index-engineer.md` | Add complete `sandbox` and `sandbox_config` frontmatter block as canonical reference. |
| `v3/@claude-flow/cli/src/commands/agent.ts` | Add `agent sandbox status --agent-id <id>` subcommand showing container/WASM runtime info. |
| `v3/@claude-flow/security/src/index.ts` | Export sandbox module alongside existing security exports. |

---

## 5. Implementation Steps

**Step 1 — Define sandbox types and frontmatter schema**

Create `v3/@claude-flow/security/src/sandbox/types.ts`. See Key Code Templates — this is the authoritative `sandbox:` frontmatter field schema.

**Step 2 — Implement `DockerSandbox`**

Create `v3/@claude-flow/security/src/sandbox/docker-sandbox.ts`. See Key Code Templates.

**Step 3 — Implement `WasmSandbox`**

Create `v3/@claude-flow/security/src/sandbox/wasm-sandbox.ts`. See Key Code Templates (lightweight stub using Node.js `vm` module for sandboxed JavaScript execution).

**Step 4 — Implement `SandboxProvisioner`**

Create `v3/@claude-flow/security/src/sandbox/sandbox-provisioner.ts`:

```typescript
import { DockerSandbox } from './docker-sandbox.js';
import { WasmSandbox } from './wasm-sandbox.js';
import type { SandboxConfig, SandboxRuntime } from './types.js';

export class SandboxProvisioner {
  static async provision(agentId: string, config: SandboxConfig): Promise<SandboxRuntime> {
    switch (config.type) {
      case 'docker':
        return DockerSandbox.create(agentId, config);
      case 'wasm':
        return WasmSandbox.create(agentId, config);
      case 'none':
        return { type: 'none', agentId, execute: (cmd) => ({ code: 0, stdout: '', stderr: '' }) };
      default:
        throw new Error(`Unknown sandbox type: ${(config as any).type}`);
    }
  }
}
```

**Step 5 — Create base Dockerfile**

Create `v3/@claude-flow/security/src/sandbox/Dockerfile.agent`. See Key Code Templates.

**Step 6 — Implement `SandboxRegistry`**

Create `v3/@claude-flow/security/src/sandbox/sandbox-registry.ts`:

```typescript
import type { SandboxRuntime } from './types.js';

export class SandboxRegistry {
  private static active: Map<string, SandboxRuntime> = new Map();

  static register(agentId: string, runtime: SandboxRuntime): void {
    SandboxRegistry.active.set(agentId, runtime);
  }

  static get(agentId: string): SandboxRuntime | undefined {
    return SandboxRegistry.active.get(agentId);
  }

  static async cleanup(agentId: string): Promise<void> {
    const runtime = SandboxRegistry.active.get(agentId);
    if (!runtime) return;
    await runtime.destroy?.();
    SandboxRegistry.active.delete(agentId);
  }

  static async cleanupAll(): Promise<void> {
    const ids = Array.from(SandboxRegistry.active.keys());
    await Promise.all(ids.map(id => SandboxRegistry.cleanup(id)));
  }

  static listActive(): Array<{ agentId: string; type: string }> {
    return Array.from(SandboxRegistry.active.entries()).map(([agentId, r]) => ({
      agentId,
      type: r.type,
    }));
  }
}
```

**Step 7 — Wire into `handleSpawnAgent` and `handleTerminateAgent`**

Edit `v3/mcp/tools/agent-tools.ts`:

- Add to `spawnAgentSchema`: `sandbox_config: sandboxConfigSchema.optional()`
- In `handleSpawnAgent`: after generating `agentId`, if `input.sandbox_config` is provided:
  ```typescript
  const sandboxRuntime = await SandboxProvisioner.provision(agentId, input.sandbox_config);
  SandboxRegistry.register(agentId, sandboxRuntime);
  ```
- In `handleTerminateAgent`: before returning success, call `await SandboxRegistry.cleanup(input.agentId)`.

**Step 8 — Update `lsp-index-engineer.md` frontmatter**

Add the `sandbox:` block to the lsp-index-engineer.md as shown in Key Code Templates → Frontmatter Schema section.

**Step 9 — Write tests**

Create `v3/@claude-flow/security/src/__tests__/sandbox.test.ts`. See Testing Strategy.

---

## 6. Key Code Templates

### `types.ts` — Frontmatter `sandbox:` Field Schema

This is the complete specification for the `sandbox:` frontmatter block. All agent markdown files may include this block under `capability:`.

```typescript
import { z } from 'zod';

// Zod schema for the sandbox: frontmatter field
export const sandboxConfigSchema = z.object({
  type: z.enum(['docker', 'wasm', 'none']).default('none')
    .describe("'docker' = full container isolation; 'wasm' = lightweight JS sandbox; 'none' = host execution"),

  // Docker-specific configuration
  image: z.string().default('node:20-alpine')
    .describe('Docker image to use for the agent sandbox'),
  allowed_paths: z.array(z.string()).default(['/workspace'])
    .describe('Host paths mounted read-write into the container. All other paths are inaccessible.'),
  read_only_paths: z.array(z.string()).default([])
    .describe('Host paths mounted read-only into the container.'),
  network: z.enum(['none', 'bridge', 'host']).default('none')
    .describe("Network access. 'none' = fully air-gapped."),
  cpu_limit: z.string().default('0.5')
    .describe('Docker --cpus value (e.g., "0.5" = 50% of one CPU core)'),
  memory_limit: z.string().default('512m')
    .describe('Docker --memory value (e.g., "512m", "2g")'),
  env_vars: z.record(z.string()).default({})
    .describe('Environment variables injected into the sandbox'),
  timeout_ms: z.number().int().positive().default(300_000)
    .describe('Maximum container lifetime in milliseconds'),
  auto_cleanup: z.boolean().default(true)
    .describe('Remove container automatically after agent termination'),

  // WASM-specific configuration
  wasm_memory_pages: z.number().int().positive().default(256)
    .describe('WASM memory pages (each = 64KB; 256 = 16MB)'),
  wasm_allowed_imports: z.array(z.string()).default([])
    .describe('WASM imports allowed (e.g., ["wasi_snapshot_preview1"])'),
}).partial();

export type SandboxConfig = z.infer<typeof sandboxConfigSchema> & { type: 'docker' | 'wasm' | 'none' };

export interface SandboxExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SandboxRuntime {
  type: 'docker' | 'wasm' | 'none';
  agentId: string;
  execute(command: string, timeoutMs?: number): Promise<SandboxExecResult>;
  destroy?(): Promise<void>;
  getStats?(): Promise<{ cpuPercent: number; memoryMb: number }>;
}
```

**Frontmatter usage example (for agent markdown files):**

```yaml
---
name: LSP/Index Engineer
description: Language Server Protocol specialist
color: orange
emoji: 🔎
vibe: Builds unified code intelligence through LSP orchestration.
tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
capability:
  planning_step: required
  plan_format: numbered-list
  confidence_threshold: 0.75
  human_input_mode: ON_LOW_CONFIDENCE
  sandbox: docker
  sandbox_config:
    image: "node:20-alpine"
    allowed_paths:
      - "/workspace"
    network: none
    cpu_limit: "0.5"
    memory_limit: "512m"
    timeout_ms: 300000
    auto_cleanup: true
---
```

### `docker-sandbox.ts`

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import type { SandboxConfig, SandboxRuntime, SandboxExecResult } from './types.js';

const execAsync = promisify(exec);

export class DockerSandbox implements SandboxRuntime {
  public readonly type = 'docker' as const;
  public readonly containerId: string;

  private constructor(
    public readonly agentId: string,
    private containerName: string,
    private config: SandboxConfig
  ) {
    this.containerId = containerName;
  }

  static async create(agentId: string, config: SandboxConfig): Promise<DockerSandbox> {
    const name = `ruflo-agent-${agentId}-${randomBytes(4).toString('hex')}`;
    const args = DockerSandbox.buildDockerArgs(name, config);

    try {
      await execAsync(`docker run -d --name ${name} ${args} ${config.image ?? 'node:20-alpine'} sleep infinity`);
    } catch (err) {
      throw new Error(`Failed to start Docker sandbox for agent ${agentId}: ${(err as Error).message}`);
    }

    return new DockerSandbox(agentId, name, config);
  }

  async execute(command: string, timeoutMs: number = 30_000): Promise<SandboxExecResult> {
    const escapedCommand = command.replace(/'/g, "'\\''");
    const dockerCmd = `docker exec --user 1000:1000 ${this.containerName} sh -c '${escapedCommand}'`;

    try {
      const { stdout, stderr } = await Promise.race([
        execAsync(dockerCmd),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
        ),
      ]);
      return { code: 0, stdout, stderr, timedOut: false };
    } catch (err) {
      const error = err as Error & { code?: number };
      if (error.message === 'TIMEOUT') {
        return { code: -1, stdout: '', stderr: 'Command timed out', timedOut: true };
      }
      return { code: error.code ?? 1, stdout: '', stderr: error.message, timedOut: false };
    }
  }

  async destroy(): Promise<void> {
    try {
      await execAsync(`docker stop ${this.containerName} && docker rm ${this.containerName}`);
    } catch {
      // Best-effort cleanup; container may already be stopped
    }
  }

  async getStats(): Promise<{ cpuPercent: number; memoryMb: number }> {
    try {
      const { stdout } = await execAsync(
        `docker stats ${this.containerName} --no-stream --format "{{.CPUPerc}},{{.MemUsage}}"`
      );
      const [cpu, mem] = stdout.trim().split(',');
      return {
        cpuPercent: parseFloat(cpu.replace('%', '')),
        memoryMb: parseFloat(mem.split('/')[0]) / (1024 * 1024),
      };
    } catch {
      return { cpuPercent: 0, memoryMb: 0 };
    }
  }

  private static buildDockerArgs(name: string, config: SandboxConfig): string {
    const parts: string[] = [
      '--rm=false',  // managed by destroy()
      `--cpus="${config.cpu_limit ?? '0.5'}"`,
      `--memory="${config.memory_limit ?? '512m'}"`,
      `--network=${config.network ?? 'none'}`,
      '--security-opt=no-new-privileges',
      '--read-only',
      '--tmpfs=/tmp:size=100m',
    ];

    for (const path of (config.allowed_paths ?? ['/workspace'])) {
      parts.push(`-v "${path}:${path}:rw"`);
    }
    for (const path of (config.read_only_paths ?? [])) {
      parts.push(`-v "${path}:${path}:ro"`);
    }
    for (const [key, val] of Object.entries(config.env_vars ?? {})) {
      parts.push(`-e "${key}=${val}"`);
    }

    return parts.join(' ');
  }
}
```

### `wasm-sandbox.ts`

```typescript
import type { SandboxConfig, SandboxRuntime, SandboxExecResult } from './types.js';
import vm from 'vm';

/**
 * Lightweight WASM/VM sandbox for agents that only need JavaScript execution.
 * Uses Node.js vm module for process isolation without Docker overhead.
 * For full shell isolation, use DockerSandbox instead.
 */
export class WasmSandbox implements SandboxRuntime {
  public readonly type = 'wasm' as const;

  constructor(
    public readonly agentId: string,
    private readonly memoryLimitBytes: number
  ) {}

  static async create(agentId: string, config: SandboxConfig): Promise<WasmSandbox> {
    const pages = config.wasm_memory_pages ?? 256;
    return new WasmSandbox(agentId, pages * 65_536);
  }

  async execute(code: string, timeoutMs: number = 5_000): Promise<SandboxExecResult> {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const sandbox = {
      console: {
        log: (...args: unknown[]) => stdout.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => stderr.push(args.map(String).join(' ')),
      },
      Buffer,
      setTimeout: undefined,  // prevent async escape
      setInterval: undefined,
      process: { env: {} },
    };

    try {
      vm.runInNewContext(code, sandbox, {
        timeout: timeoutMs,
        displayErrors: true,
      });
      return { code: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n'), timedOut: false };
    } catch (err) {
      const error = err as Error;
      if (error.message.includes('timed out') || error.message.includes('Script execution timed out')) {
        return { code: -1, stdout: '', stderr: 'Script timed out', timedOut: true };
      }
      return { code: 1, stdout: stdout.join('\n'), stderr: error.message, timedOut: false };
    }
  }

  async destroy(): Promise<void> {
    // No persistent resources to clean up for VM sandbox
  }
}
```

### `Dockerfile.agent`

```dockerfile
# Base image for ruflo agent sandboxes
# Agents are run as non-root user (uid 1000) in a minimal Alpine environment
FROM node:20-alpine

# Security: remove shell utilities that could be abused
RUN apk del --purge curl wget ncurses util-linux \
    && rm -rf /var/cache/apk/*

# Create non-root agent user
RUN addgroup -g 1000 agent && adduser -u 1000 -G agent -s /bin/sh -D agent

# Create workspace directory owned by agent user
RUN mkdir -p /workspace && chown agent:agent /workspace

# Drop to non-root user
USER agent
WORKDIR /workspace

# No ENTRYPOINT or CMD — caller provides commands via docker exec
```

---

## 7. Testing Strategy

File: `v3/@claude-flow/security/src/__tests__/sandbox.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SandboxRegistry } from '../sandbox/sandbox-registry.js';
import { WasmSandbox } from '../sandbox/wasm-sandbox.js';
import { sandboxConfigSchema } from '../sandbox/types.js';

describe('sandboxConfigSchema', () => {
  it('accepts minimal config with just type', () => {
    const result = sandboxConfigSchema.safeParse({ type: 'docker' });
    expect(result.success).toBe(true);
  });

  it('applies defaults for all optional fields', () => {
    const result = sandboxConfigSchema.safeParse({ type: 'docker' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.image).toBe('node:20-alpine');
      expect(result.data.network).toBe('none');
      expect(result.data.cpu_limit).toBe('0.5');
      expect(result.data.memory_limit).toBe('512m');
    }
  });

  it('rejects unknown type values', () => {
    const result = sandboxConfigSchema.safeParse({ type: 'kubernetes' });
    expect(result.success).toBe(false);
  });
});

describe('WasmSandbox', () => {
  it('executes simple JavaScript and captures stdout', async () => {
    const sandbox = await WasmSandbox.create('agent-1', { type: 'wasm' });
    const result = await sandbox.execute('console.log("hello world")');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('hello world');
  });

  it('captures errors in stderr', async () => {
    const sandbox = await WasmSandbox.create('agent-1', { type: 'wasm' });
    const result = await sandbox.execute('throw new Error("oops")');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('oops');
  });

  it('times out long-running scripts', async () => {
    const sandbox = await WasmSandbox.create('agent-1', { type: 'wasm' });
    // VM timeout: 50ms; script tries to spin forever
    const result = await sandbox.execute('let i = 0; while(true) { i++; }', 50);
    expect(result.timedOut).toBe(true);
    expect(result.code).toBe(-1);
  });

  it('prevents access to fs module (sandboxed)', async () => {
    const sandbox = await WasmSandbox.create('agent-1', { type: 'wasm' });
    const result = await sandbox.execute('require("fs").readFileSync("/etc/passwd")');
    expect(result.code).toBe(1); // require is not defined in sandbox
  });
});

describe('SandboxRegistry', () => {
  beforeEach(() => {
    (SandboxRegistry as any).active = new Map();
  });

  it('registers and retrieves a sandbox runtime', async () => {
    const mockRuntime = { type: 'wasm' as const, agentId: 'a1', execute: vi.fn() };
    SandboxRegistry.register('a1', mockRuntime);
    expect(SandboxRegistry.get('a1')).toBe(mockRuntime);
  });

  it('cleanup removes the entry and calls destroy()', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    SandboxRegistry.register('a1', { type: 'wasm', agentId: 'a1', execute: vi.fn(), destroy });
    await SandboxRegistry.cleanup('a1');
    expect(destroy).toHaveBeenCalledOnce();
    expect(SandboxRegistry.get('a1')).toBeUndefined();
  });

  it('listActive returns all registered runtimes', () => {
    SandboxRegistry.register('a1', { type: 'docker', agentId: 'a1', execute: vi.fn() });
    SandboxRegistry.register('a2', { type: 'wasm',   agentId: 'a2', execute: vi.fn() });
    const list = SandboxRegistry.listActive();
    expect(list).toHaveLength(2);
    expect(list.map(e => e.type)).toContain('docker');
    expect(list.map(e => e.type)).toContain('wasm');
  });
});
```

**Docker integration test** (requires Docker on the test host, marked `@integration`):

```typescript
it.skip('DockerSandbox executes command inside container', async () => {
  const sandbox = await DockerSandbox.create('test-agent', {
    type: 'docker',
    image: 'node:20-alpine',
    allowed_paths: ['/tmp'],
    network: 'none',
    cpu_limit: '0.1',
    memory_limit: '64m',
    timeout_ms: 10_000,
    auto_cleanup: true,
  });
  const result = await sandbox.execute('echo "sandboxed"');
  expect(result.stdout.trim()).toBe('sandboxed');
  await sandbox.destroy();
});
```

---

## 8. Definition of Done

- [ ] `sandboxConfigSchema` Zod schema validates and applies defaults for all `sandbox:` frontmatter fields.
- [ ] `DockerSandbox` creates, executes commands in, and destroys Docker containers with correct resource limits (`--cpus`, `--memory`, `--network none`, `--read-only`, `--security-opt no-new-privileges`).
- [ ] `Dockerfile.agent` builds successfully: `docker build -f Dockerfile.agent -t ruflo-agent-base .`
- [ ] `WasmSandbox` executes JavaScript in Node.js `vm` context with `setTimeout` and `setInterval` blocked.
- [ ] `WasmSandbox` correctly times out and returns `{ timedOut: true }` for infinite loops.
- [ ] `SandboxRegistry.cleanup` calls `runtime.destroy()` and removes the agent entry.
- [ ] `spawnAgentSchema` includes `sandbox_config` with full Zod validation.
- [ ] `handleSpawnAgent` provisions a sandbox when `sandbox_config.type !== 'none'`.
- [ ] `handleTerminateAgent` calls `SandboxRegistry.cleanup` for every terminated agent.
- [ ] `lsp-index-engineer.md` contains the complete `sandbox:` frontmatter block as documented above.
- [ ] All unit tests in `sandbox.test.ts` pass (WasmSandbox tests run without Docker).
- [ ] Docker integration test passes when Docker is available on CI.
- [ ] TypeScript compiles with zero errors.
