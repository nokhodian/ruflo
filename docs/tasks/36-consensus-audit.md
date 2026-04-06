# Task 36: Consensus Proof + Voting Audit Log
**Priority:** Phase 4 — Ecosystem Maturity
**Effort:** Medium
**Depends on:** (none — can be implemented independently against existing consensus implementations)
**Blocks:** (none)

## 1. Current State

Ruflo implements five consensus protocols across the swarm coordination layer:

| Protocol | Implementation location | Fault tolerance |
|---|---|---|
| Byzantine (BFT) | `v3/mcp/tools/swarm-tools.ts` | f < n/3 faulty nodes |
| Raft | `v3/mcp/tools/swarm-tools.ts` | f < n/2 |
| Gossip | `v3/mcp/tools/swarm-tools.ts` | Eventual consistency |
| CRDT | `v3/mcp/tools/swarm-tools.ts` | Conflict-free merges |
| Quorum | `v3/mcp/tools/swarm-tools.ts` | Configurable quorum |

The `coordination_consensus` MCP tool (`v3/mcp/tools/swarm-tools.ts`) runs consensus rounds but does not write any audit records. When a Byzantine or Raft round completes, the decision and votes are not persisted — they exist only in process memory until the swarm terminates.

The hive-mind consensus tool (`v3/mcp/tools/swarm-tools.ts` — `hive_mind_consensus`) similarly produces a result but writes no audit trail.

**Relevant files:**
- `/Users/morteza/Desktop/tools/ruflo/v3/mcp/tools/swarm-tools.ts` — all consensus tool handlers
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` — AgentDB
- `/Users/morteza/Desktop/tools/ruflo/v3/@claude-flow/cli/src/commands/swarm.ts` — swarm CLI

## 2. Gap Analysis

**What's missing:**
1. No `consensus_audit_log` table in AgentDB — consensus decisions are ephemeral
2. No vote recording — individual agent votes are discarded after round completion
3. No quorum proof — cannot demonstrate after the fact that quorum was achieved
4. No digital signature on votes — agents can claim they voted differently than they did
5. No CLI to query historical consensus decisions
6. In distributed deployments: no way to audit Byzantine fault tolerance claims

**Concrete failure modes:**
- A Byzantine agent casts a conflicting vote that is silently ignored; no record exists to investigate the anomaly
- A Raft leader makes a unilateral decision without achieving quorum; the system accepts it; no audit trail flags the violation
- Post-incident investigation of a swarm failure cannot reconstruct which agents voted for which decision
- Compliance requirements (e.g., financial, healthcare agents) need proof that decisions were reached by proper quorum

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `v3/@claude-flow/cli/src/consensus/audit-writer.ts` | Writes `ConsensusAuditRecord` to AgentDB after each consensus round |
| `v3/@claude-flow/cli/src/consensus/vote-signer.ts` | Signs individual agent votes using HMAC-SHA256 with per-agent key |
| `v3/@claude-flow/cli/src/commands/consensus.ts` | CLI: `consensus audit list`, `consensus audit show`, `consensus audit verify` |
| `v3/@claude-flow/shared/src/types/consensus-audit.ts` | `ConsensusAuditRecord`, `VoteRecord`, `QuorumProof` TypeScript interfaces |

## 4. Files to Modify

| Path | Change |
|------|--------|
| `v3/mcp/tools/swarm-tools.ts` | After each consensus round completion, call `AuditWriter.record()`; pass vote array to writer |
| `v3/@claude-flow/memory/src/agentdb-backend.ts` | Add `consensus_audit_log` and `consensus_votes` table migrations |
| `v3/@claude-flow/cli/src/commands/swarm.ts` | Register `consensus` subcommand |

## 5. Implementation Steps

**Step 1: Define shared types**

Create `v3/@claude-flow/shared/src/types/consensus-audit.ts`:

```typescript
export type ConsensusProtocol = 'byzantine' | 'raft' | 'gossip' | 'crdt' | 'quorum';

export interface VoteRecord {
  agentId: string;
  agentSlug: string;
  vote: unknown;            // the actual vote value (serialized as JSON string in DB)
  signature: string;        // HMAC-SHA256(agentId + JSON.stringify(vote) + decisionId)
  votedAt: string;          // ISO 8601
}

export interface QuorumProof {
  required: number;         // minimum votes needed
  achieved: number;         // votes cast
  threshold: number;        // fraction e.g. 0.67 for 2/3
  satisfied: boolean;
}

export interface ConsensusAuditRecord {
  decisionId: string;       // uuid
  swarmId: string;
  protocol: ConsensusProtocol;
  topic: string;            // what was being decided, e.g. "task-assignment"
  decision: unknown;        // the final decision value
  votes: VoteRecord[];
  quorumProof: QuorumProof;
  quorumAchieved: boolean;
  round: number;            // consensus round number within this swarm
  startedAt: string;        // ISO 8601
  completedAt: string;      // ISO 8601
  durationMs: number;
}
```

**Step 2: Add AgentDB tables**

In `v3/@claude-flow/memory/src/agentdb-backend.ts`:

```typescript
await db.exec(`
  CREATE TABLE IF NOT EXISTS consensus_audit_log (
    decision_id       TEXT    PRIMARY KEY,
    swarm_id          TEXT    NOT NULL,
    protocol          TEXT    NOT NULL,
    topic             TEXT    NOT NULL,
    decision          TEXT    NOT NULL,   -- JSON
    quorum_required   INTEGER NOT NULL,
    quorum_achieved   INTEGER NOT NULL,
    quorum_threshold  REAL    NOT NULL,
    quorum_satisfied  INTEGER NOT NULL,   -- 0 or 1
    round             INTEGER NOT NULL,
    started_at        TEXT    NOT NULL,
    completed_at      TEXT    NOT NULL,
    duration_ms       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS consensus_votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_id TEXT    NOT NULL REFERENCES consensus_audit_log(decision_id),
    agent_id    TEXT    NOT NULL,
    agent_slug  TEXT    NOT NULL,
    vote        TEXT    NOT NULL,   -- JSON
    signature   TEXT    NOT NULL,   -- HMAC-SHA256 hex
    voted_at    TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_consensus_swarm    ON consensus_audit_log(swarm_id);
  CREATE INDEX IF NOT EXISTS idx_consensus_protocol ON consensus_audit_log(protocol);
  CREATE INDEX IF NOT EXISTS idx_consensus_quorum   ON consensus_audit_log(quorum_satisfied);
  CREATE INDEX IF NOT EXISTS idx_consensus_votes_decision ON consensus_votes(decision_id);
  CREATE INDEX IF NOT EXISTS idx_consensus_votes_agent    ON consensus_votes(agent_id);
`);
```

**Step 3: Implement vote-signer**

Create `v3/@claude-flow/cli/src/consensus/vote-signer.ts`:

```typescript
import { createHmac } from 'crypto';

// Per-swarm signing key — derived from swarmId + a session secret
export function deriveSigningKey(swarmId: string, sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update(swarmId).digest('hex');
}

export function signVote(agentId: string, vote: unknown, decisionId: string, key: string): string {
  const payload = `${agentId}:${decisionId}:${JSON.stringify(vote)}`;
  return createHmac('sha256', key).update(payload).digest('hex');
}

export function verifyVote(agentId: string, vote: unknown, decisionId: string, signature: string, key: string): boolean {
  const expected = signVote(agentId, vote, decisionId, key);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
```

**Step 4: Implement audit-writer**

Create `v3/@claude-flow/cli/src/consensus/audit-writer.ts`:

```typescript
import { randomUUID } from 'crypto';
import { signVote, deriveSigningKey } from './vote-signer.js';
import type { ConsensusAuditRecord, VoteRecord, QuorumProof } from '@claude-flow/shared/src/types/consensus-audit.js';

export interface VoteInput {
  agentId: string;
  agentSlug: string;
  vote: unknown;
}

export interface ConsensusRoundInput {
  swarmId: string;
  protocol: ConsensusAuditRecord['protocol'];
  topic: string;
  decision: unknown;
  votes: VoteInput[];
  quorumThreshold: number;  // e.g. 0.67 for 2/3
  round: number;
  startedAt: Date;
  sessionSecret: string;
}

export class AuditWriter {
  constructor(private db: AgentDBBackend) {}

  async record(input: ConsensusRoundInput): Promise<ConsensusAuditRecord> {
    const decisionId = randomUUID();
    const completedAt = new Date();
    const signingKey = deriveSigningKey(input.swarmId, input.sessionSecret);

    const voteRecords: VoteRecord[] = input.votes.map(v => ({
      agentId: v.agentId,
      agentSlug: v.agentSlug,
      vote: v.vote,
      signature: signVote(v.agentId, v.vote, decisionId, signingKey),
      votedAt: new Date().toISOString(),
    }));

    const quorumProof: QuorumProof = {
      required: Math.ceil(input.votes.length * input.quorumThreshold),
      achieved: input.votes.length,
      threshold: input.quorumThreshold,
      satisfied: input.votes.length >= Math.ceil(input.votes.length * input.quorumThreshold),
    };

    const record: ConsensusAuditRecord = {
      decisionId,
      swarmId: input.swarmId,
      protocol: input.protocol,
      topic: input.topic,
      decision: input.decision,
      votes: voteRecords,
      quorumProof,
      quorumAchieved: quorumProof.satisfied,
      round: input.round,
      startedAt: input.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - input.startedAt.getTime(),
    };

    // Persist decision record
    await this.db.run(
      `INSERT INTO consensus_audit_log
       (decision_id, swarm_id, protocol, topic, decision, quorum_required, quorum_achieved,
        quorum_threshold, quorum_satisfied, round, started_at, completed_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.decisionId, record.swarmId, record.protocol, record.topic,
       JSON.stringify(record.decision), record.quorumProof.required, record.quorumProof.achieved,
       record.quorumProof.threshold, record.quorumAchieved ? 1 : 0, record.round,
       record.startedAt, record.completedAt, record.durationMs]
    );

    // Persist individual votes
    for (const vote of voteRecords) {
      await this.db.run(
        `INSERT INTO consensus_votes (decision_id, agent_id, agent_slug, vote, signature, voted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [decisionId, vote.agentId, vote.agentSlug, JSON.stringify(vote.vote), vote.signature, vote.votedAt]
      );
    }

    return record;
  }

  async listDecisions(swarmId?: string, limit = 50): Promise<ConsensusAuditRecord[]> {
    const rows = swarmId
      ? await this.db.all('SELECT * FROM consensus_audit_log WHERE swarm_id = ? ORDER BY completed_at DESC LIMIT ?', [swarmId, limit])
      : await this.db.all('SELECT * FROM consensus_audit_log ORDER BY completed_at DESC LIMIT ?', [limit]);

    return Promise.all(rows.map(async row => {
      const votes = await this.db.all('SELECT * FROM consensus_votes WHERE decision_id = ?', [row.decision_id]);
      return this.mapRow(row, votes);
    }));
  }

  async verifyDecision(decisionId: string, sessionSecret: string): Promise<{ valid: boolean; invalidVotes: string[] }> {
    const row = await this.db.get('SELECT * FROM consensus_audit_log WHERE decision_id = ?', [decisionId]);
    if (!row) throw new Error(`Decision ${decisionId} not found`);
    const votes = await this.db.all('SELECT * FROM consensus_votes WHERE decision_id = ?', [decisionId]);
    const signingKey = deriveSigningKey(row.swarm_id, sessionSecret);
    const invalidVotes: string[] = [];
    for (const v of votes) {
      const valid = verifyVote(v.agent_id, JSON.parse(v.vote), decisionId, v.signature, signingKey);
      if (!valid) invalidVotes.push(v.agent_id);
    }
    return { valid: invalidVotes.length === 0, invalidVotes };
  }

  private mapRow(row: any, voteRows: any[]): ConsensusAuditRecord {
    return {
      decisionId: row.decision_id,
      swarmId: row.swarm_id,
      protocol: row.protocol,
      topic: row.topic,
      decision: JSON.parse(row.decision),
      votes: voteRows.map(v => ({
        agentId: v.agent_id, agentSlug: v.agent_slug,
        vote: JSON.parse(v.vote), signature: v.signature, votedAt: v.voted_at
      })),
      quorumProof: {
        required: row.quorum_required, achieved: row.quorum_achieved,
        threshold: row.quorum_threshold, satisfied: row.quorum_satisfied === 1
      },
      quorumAchieved: row.quorum_satisfied === 1,
      round: row.round,
      startedAt: row.started_at, completedAt: row.completed_at, durationMs: row.duration_ms,
    };
  }
}
```

**Step 5: Hook into swarm-tools.ts consensus handler**

In `v3/mcp/tools/swarm-tools.ts`, after each consensus round, add:

```typescript
import { AuditWriter } from '../../@claude-flow/cli/src/consensus/audit-writer.js';

// Inside consensus handler, after decision is reached:
const auditWriter = new AuditWriter(ctx.db);
await auditWriter.record({
  swarmId: input.swarmId,
  protocol: input.protocol,
  topic: input.topic,
  decision: consensusResult.decision,
  votes: consensusResult.votes.map(v => ({
    agentId: v.agentId,
    agentSlug: v.agentSlug,
    vote: v.value,
  })),
  quorumThreshold: getQuorumThreshold(input.protocol),
  round: consensusResult.round,
  startedAt: roundStartTime,
  sessionSecret: ctx.sessionSecret ?? 'default-secret',
});
```

**Step 6: CLI commands**

Create `v3/@claude-flow/cli/src/commands/consensus.ts`:

```typescript
import { Command } from 'commander';

export function registerConsensusCommand(program: Command): void {
  const cmd = program.command('consensus').description('Consensus audit log operations');

  cmd.command('audit list')
    .option('--swarm-id <id>', 'Filter by swarm ID')
    .option('--protocol <p>', 'Filter by protocol: byzantine|raft|gossip|crdt|quorum')
    .option('--failed-quorum', 'Show only decisions where quorum was not satisfied')
    .option('--json', 'Output as JSON')
    .action(async (opts) => { /* ... */ });

  cmd.command('audit show')
    .argument('<decisionId>')
    .action(async (decisionId) => {
      const writer = await getAuditWriter();
      const decisions = await writer.listDecisions();
      const record = decisions.find(d => d.decisionId === decisionId);
      if (!record) { console.error(`Decision ${decisionId} not found`); process.exitCode = 1; return; }
      console.log(JSON.stringify(record, null, 2));
    });

  cmd.command('audit verify')
    .argument('<decisionId>')
    .description('Verify vote signatures for a decision')
    .action(async (decisionId) => {
      const writer = await getAuditWriter();
      const result = await writer.verifyDecision(decisionId, process.env.SESSION_SECRET ?? '');
      if (result.valid) {
        console.log('All votes verified ✓');
      } else {
        console.error(`Invalid signatures for agents: ${result.invalidVotes.join(', ')}`);
        process.exitCode = 1;
      }
    });
}
```

## 6. Key Code Templates

**`ConsensusAuditRecord` full example:**

```json
{
  "decisionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "swarmId": "swarm-1k9abc",
  "protocol": "raft",
  "topic": "task-assignment:task-123",
  "decision": { "assignedTo": "engineering-backend-architect", "priority": "high" },
  "votes": [
    {
      "agentId": "agent-1kxyz-abc",
      "agentSlug": "hierarchical-coordinator",
      "vote": { "assignedTo": "engineering-backend-architect" },
      "signature": "a3f1c2e4b5d6...",
      "votedAt": "2026-04-06T12:00:00.100Z"
    }
  ],
  "quorumProof": {
    "required": 3,
    "achieved": 4,
    "threshold": 0.67,
    "satisfied": true
  },
  "quorumAchieved": true,
  "round": 1,
  "startedAt": "2026-04-06T12:00:00.000Z",
  "completedAt": "2026-04-06T12:00:00.250Z",
  "durationMs": 250
}
```

**CLI commands:**

```bash
# List last 50 consensus decisions
npx claude-flow@v3alpha consensus audit list

# Show specific decision with all votes
npx claude-flow@v3alpha consensus audit show <decisionId>

# Verify vote signatures
npx claude-flow@v3alpha consensus audit verify <decisionId>

# Filter to decisions where quorum failed
npx claude-flow@v3alpha consensus audit list --failed-quorum
```

## 7. Testing Strategy

**Unit tests** (`v3/@claude-flow/cli/tests/consensus/vote-signer.test.ts`):
- `signVote()` produces deterministic output given same inputs
- `verifyVote()` returns `true` for a valid signature
- `verifyVote()` returns `false` for a tampered vote value
- `verifyVote()` returns `false` for a different `decisionId`

**Unit tests** (`v3/@claude-flow/cli/tests/consensus/audit-writer.test.ts`):
- `record()` inserts one row into `consensus_audit_log`
- `record()` inserts N rows into `consensus_votes` (one per input vote)
- `quorumProof.satisfied` is `true` when vote count >= required
- `quorumProof.satisfied` is `false` when vote count < required
- `listDecisions(swarmId)` returns only records for that swarm
- `verifyDecision()` returns `valid: true` when all signatures are correct
- `verifyDecision()` returns invalid agent IDs when signatures are tampered

**Integration tests** (`v3/mcp/tests/swarm-tools-consensus.test.ts`):
- `coordination_consensus` tool call results in a row in `consensus_audit_log`
- `hive_mind_consensus` tool call results in a row in `consensus_audit_log`

## 8. Definition of Done

- [ ] `consensus_audit_log` and `consensus_votes` tables exist in AgentDB after `init`
- [ ] Every `coordination_consensus` and `hive_mind_consensus` tool call writes an audit record
- [ ] `quorumProof` correctly reflects actual vote counts vs threshold
- [ ] Vote signatures use HMAC-SHA256 with per-swarm derived key
- [ ] `npx claude-flow@v3alpha consensus audit list` returns records from recent swarm runs
- [ ] `npx claude-flow@v3alpha consensus audit verify <id>` exits 0 for unmodified decisions
- [ ] All unit tests pass
- [ ] TypeScript compiles without errors
