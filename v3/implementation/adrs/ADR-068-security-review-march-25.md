# ADR-068: Security Audit — March 25, 2026

| Field        | Value                                              |
|--------------|----------------------------------------------------|
| **Status**   | Accepted                                           |
| **Date**     | 2026-03-25                                         |
| **Author**   | Security Review Team                               |
| **Applies**  | v3.5.43 (branch `fix/issue-fixes-march-20`)        |

## Context

A comprehensive security review was conducted across the v3.5.43 codebase covering
the CLI package, plugin subsystem, memory backends, hooks, and security modules.
The audit evaluated injection vectors, path traversal, cryptographic practices,
input validation coverage, and compliance posture (HIPAA, SOC-2).

Thirty (30) discrete findings were identified spanning four severity tiers.
Several critical and high issues were remediated in this PR and are marked
**FIXED** below.

## Decision

1. **Critical and High findings** — remediate immediately in this PR or the
   next patch release. No critical issue may ship unfixed.
2. **Medium findings** — file tracking issues; remediate within two sprints.
3. **Low findings** — document for awareness; address opportunistically.
4. All fixes must include regression tests before the PR merges.

---

## Summary Table

| #  | Severity      | Package            | File                          | Finding                                              | Status   |
|----|---------------|--------------------|-------------------------------|------------------------------------------------------|----------|
| 1  | CRITICAL      | CLI                | executor.ts                   | Command injection via `node -e` string interpolation | Open     |
| 2  | CRITICAL      | Plugins            | QESecurityBridge.ts           | Code injection in JSON template (`node -e`)          | Open     |
| 3  | CRITICAL      | Plugins            | QESecurityBridge.ts           | `Math.random()` UUID in audit entries                | **FIXED** |
| 4  | CRITICAL      | Memory             | database-provider.ts          | Unsafe `JSON.parse` on untrusted input               | **FIXED** |
| 5  | HIGH          | CLI                | rvfa-distribution.ts          | Unsafe URL — no validation on user-controlled input  | Open     |
| 6  | HIGH          | CLI                | gcs.ts                        | Path traversal via TMPDIR env + race condition        | Open     |
| 7  | HIGH          | CLI                | publish.ts                    | Unvalidated private key file read, no permission check | Open   |
| 8  | HIGH          | Plugins            | healthcare mcp-tools.ts       | HIPAA audit gap — placeholder hashing                | Open     |
| 9  | HIGH          | Plugins            | healthcare mcp-tools.ts       | Weak 32-bit hash for PHI identifiers                 | **FIXED** |
| 10 | HIGH          | Plugins            | prime-radiant wasm-bridge.ts  | Path traversal in WASM bridge                        | **FIXED** |
| 11 | HIGH          | Memory             | database-provider.ts          | Non-atomic file write (corruption on crash)           | **FIXED** |
| 12 | HIGH          | Memory             | sqlite/sqljs/agentdb backends | Unsafe `JSON.parse` across multiple backends         | **FIXED** |
| 13 | HIGH          | Memory             | migration.ts                  | Unsafe `JSON.parse` on migration data                | Open     |
| 14 | MEDIUM-HIGH   | CLI                | helpers-generator.ts          | Unsafe `JSON.parse` in generated code                | Open     |
| 15 | MEDIUM        | CLI                | discovery.ts                  | SSRF risk in npm download stats fetch                | Open     |
| 16 | MEDIUM        | CLI                | daemon.ts                     | Windows `shell=true` in child_process spawn          | Open     |
| 17 | MEDIUM        | CLI                | helpers-generator.ts          | Dynamic import path from user input                  | Open     |
| 18 | MEDIUM        | CLI                | gcs.ts                        | TOCTOU in temp file cleanup                          | Open     |
| 19 | MEDIUM        | CLI                | rvfa-distribution.ts          | No certificate pinning on distribution endpoint      | Open     |
| 20 | MEDIUM        | CLI                | discovery.ts                  | Minimal CID validation for IPFS hashes               | Open     |
| 21 | MEDIUM        | Plugins            | healthcare mcp-tools.ts       | Default-allow authorization policy                   | Open     |
| 22 | MEDIUM        | Plugins            | healthcare mcp-tools.ts       | Anonymous user access permitted                      | Open     |
| 23 | MEDIUM        | Plugins            | teammate-bridge.ts            | JSON deserialization DoS (large payloads)             | Open     |
| 24 | MEDIUM        | Plugins            | teammate-bridge.ts            | Validation edge case on malformed input              | Open     |
| 25 | MEDIUM        | Memory/Hooks       | rvf-event-log.ts              | Predictable temp file names                          | Open     |
| 26 | MEDIUM        | Memory             | multiple backends             | Inconsistent tag validation across backends          | Open     |
| 27 | LOW           | CLI                | gcs.ts                        | ReDoS in bucket regex (not exploitable)              | Open     |
| 28 | LOW           | CLI                | multiple files                | Hardcoded IPFS gateway URLs                          | Open     |
| 29 | LOW           | Plugins            | QESecurityBridge.ts           | Weak IP address regex                                | Open     |
| 30 | LOW           | Plugins            | teammate-bridge.ts            | Unused sanitizer function                            | Open     |

---

## Detailed Findings

### CLI Package (`v3/@claude-flow/cli/src/`) — 13 Findings

#### Finding 1 — CRITICAL: Command Injection in executor.ts

**File:** `executor.ts` (hook generation)

The hook executor constructs shell commands using `node -e` with direct string
interpolation of user-supplied values. An attacker who controls hook parameters
can break out of the quoted string and execute arbitrary commands.

**Recommendation:** Replace string interpolation with argument passing via
`--eval` combined with `process.argv`, or spawn a worker with structured IPC
instead of shell evaluation.

---

#### Finding 2 — HIGH: Unsafe URL in rvfa-distribution.ts

**File:** `rvfa-distribution.ts`

User-controlled URLs are fetched without validation against an allowlist. This
permits SSRF against internal services when the CLI runs in a cloud environment.

**Recommendation:** Validate URLs against an explicit allowlist of permitted
hosts. Reject private/internal IP ranges.

---

#### Finding 3 — HIGH: Path Traversal in gcs.ts

**File:** `gcs.ts`

The `TMPDIR` environment variable is concatenated into file paths without
sanitization. Combined with a TOCTOU race between creation and use, an attacker
with local access can redirect writes to arbitrary paths.

**Recommendation:** Use `PathValidator.validatePath()` from `@claude-flow/security`
before any filesystem operation involving environment-derived paths.

---

#### Finding 4 — HIGH: Unvalidated Private Key Read in publish.ts

**File:** `publish.ts`

The publish command reads a private key file path from user input without
verifying file permissions or ownership. On multi-user systems this could read
another user's key if the path is attacker-controlled.

**Recommendation:** Check file ownership matches the current UID and permissions
are `0600` or stricter before reading key material.

---

#### Finding 5 — MEDIUM-HIGH: Unsafe JSON.parse in helpers-generator.ts

**File:** `helpers-generator.ts` (generated output)

Code emitted by the helpers generator includes bare `JSON.parse()` calls without
try-catch. Malformed JSON from external sources will crash the consuming process.

**Recommendation:** Wrap generated `JSON.parse` calls in try-catch or use the
`safeParse` utility from the security package.

---

#### Finding 6 — MEDIUM: SSRF Risk in discovery.ts

**File:** `discovery.ts`

The npm download stats fetcher constructs URLs from package names without
sanitization, allowing crafted package names to redirect requests to internal
endpoints.

**Recommendation:** Validate package names against the npm naming rules regex
before constructing fetch URLs.

---

#### Finding 7 — MEDIUM: Windows shell=true in daemon.ts

**File:** `daemon.ts`

On Windows, `child_process.spawn` is called with `shell: true`, which enables
cmd.exe metacharacter expansion on arguments derived from configuration.

**Recommendation:** Avoid `shell: true` on Windows. Use direct executable
invocation or escape arguments with a platform-aware sanitizer.

---

#### Finding 8 — MEDIUM: Dynamic Import Path in helpers-generator.ts

**File:** `helpers-generator.ts`

A dynamic `import()` call uses a path partially derived from user input. While
exploitation requires local file write access, it weakens defense-in-depth.

**Recommendation:** Restrict import paths to a known allowlist of module
identifiers.

---

#### Finding 9 — MEDIUM: TOCTOU in gcs.ts Temp File Cleanup

**File:** `gcs.ts`

Temporary files are checked for existence and then deleted in separate
operations. A symlink swap between check and delete can cause deletion of
unintended files.

**Recommendation:** Use `fs.rm` with `{ force: true }` directly, or operate
within a directory created with `fs.mkdtemp` with restrictive permissions.

---

#### Finding 10 — MEDIUM: No Certificate Pinning in rvfa-distribution.ts

**File:** `rvfa-distribution.ts`

HTTPS connections to the distribution endpoint do not pin certificates or public
keys. A compromised CA could MITM distribution downloads.

**Recommendation:** Implement certificate pinning or verify download checksums
against a separately distributed manifest.

---

#### Finding 11 — MEDIUM: Minimal CID Validation in discovery.ts

**File:** `discovery.ts`

IPFS CIDs are accepted with only a basic length check. Malformed CIDs could
cause unexpected behavior in downstream IPFS operations.

**Recommendation:** Validate CIDs using the `multiformats/cid` library before
use.

---

#### Finding 12 — LOW: ReDoS in gcs.ts Bucket Regex

**File:** `gcs.ts`

The bucket name validation regex has theoretical super-linear backtracking, but
practical input lengths (max 63 chars per GCS rules) prevent exploitation.

**Recommendation:** No immediate action required. Consider simplifying the regex
if the validation logic is refactored.

---

#### Finding 13 — LOW: Hardcoded IPFS Gateway URLs

**File:** multiple CLI files

IPFS gateway URLs are hardcoded rather than configurable. This creates a
single point of failure and prevents use of private gateways.

**Recommendation:** Move gateway URLs to configuration with sensible defaults.

---

### Plugins (`v3/plugins/`) — 11 Findings

#### Finding 14 — CRITICAL: Code Injection in QESecurityBridge.ts

**File:** `QESecurityBridge.ts`

A JSON template containing `node -e` commands uses string interpolation with
values from the security scan context. An attacker who controls scanned file
content can inject arbitrary shell commands into the audit pipeline.

**Recommendation:** Replace `node -e` shell execution with direct function
calls. Never pass untrusted data through shell interpolation.

---

#### Finding 15 — CRITICAL: Math.random() UUID — FIXED

**File:** `QESecurityBridge.ts`

Audit entry identifiers were generated using `Math.random()`, which is not
cryptographically secure and produces predictable values.

**Fix applied:** Replaced with `crypto.randomUUID()` which provides
cryptographically random v4 UUIDs.

---

#### Finding 16 — HIGH: HIPAA Audit Gap in Healthcare mcp-tools.ts

**File:** `healthcare/mcp-tools.ts`

The PHI audit trail uses a placeholder hashing function that does not meet HIPAA
technical safeguard requirements for integrity controls (45 CFR 164.312(c)(1)).

**Recommendation:** Implement HMAC-SHA-256 audit hashing with a managed key.
Add audit log integrity verification on read.

---

#### Finding 17 — HIGH: Weak 32-bit Hash — FIXED

**File:** `healthcare/mcp-tools.ts`

PHI identifiers were hashed with a 32-bit algorithm, making collision attacks
trivial.

**Fix applied:** Upgraded to SHA-256 via `crypto.createHash('sha256')`.

---

#### Finding 18 — HIGH: Path Traversal in WASM Bridge — FIXED

**File:** `prime-radiant/wasm-bridge.ts`

The WASM module loader accepted relative paths with `..` sequences, allowing
loading of arbitrary files as WASM modules.

**Fix applied:** Added path traversal check that rejects paths containing `..`
and validates against an allowed base directory.

---

#### Finding 19 — MEDIUM: Default-Allow Auth in Healthcare mcp-tools.ts

**File:** `healthcare/mcp-tools.ts`

The authorization middleware defaults to allow when no policy is matched. In a
healthcare context this violates the principle of least privilege.

**Recommendation:** Change default policy to deny. Require explicit grants for
all PHI access operations.

---

#### Finding 20 — MEDIUM: Anonymous User Access in Healthcare mcp-tools.ts

**File:** `healthcare/mcp-tools.ts`

Requests without authentication headers are processed with an anonymous user
context that has read permissions on non-PHI endpoints. Some endpoints
incorrectly classify data as non-PHI.

**Recommendation:** Require authentication for all healthcare endpoints. Remove
the anonymous fallback.

---

#### Finding 21 — MEDIUM: JSON DoS in teammate-bridge.ts

**File:** `teammate-bridge.ts`

The bridge accepts arbitrarily large JSON payloads without size limits. A
malicious teammate agent could send a multi-gigabyte payload causing OOM.

**Recommendation:** Enforce a maximum payload size (e.g., 10 MB) before
parsing. Use streaming JSON parsing for large messages.

---

#### Finding 22 — MEDIUM: Validation Edge Case in teammate-bridge.ts

**File:** `teammate-bridge.ts`

Certain malformed message structures pass validation but cause undefined
behavior in downstream handlers (e.g., missing `type` field with present
`payload`).

**Recommendation:** Tighten Zod schemas to require all mandatory fields and
reject unknown keys.

---

#### Finding 23 — LOW: Weak IP Regex in QESecurityBridge.ts

**File:** `QESecurityBridge.ts`

The IP address extraction regex accepts malformed octets (e.g., `999.999.999.999`)
and may miss IPv6 addresses entirely.

**Recommendation:** Use a proper IP parsing library (`net.isIP()` in Node.js)
instead of regex.

---

#### Finding 24 — LOW: Unused Sanitizer in teammate-bridge.ts

**File:** `teammate-bridge.ts`

A sanitization function is defined but never called in any code path. Dead code
may mislead reviewers into thinking input is sanitized when it is not.

**Recommendation:** Either wire the sanitizer into the input pipeline or remove
it to avoid false confidence.

---

### Memory, Hooks, and Security (`v3/@claude-flow/`) — 6 Findings

#### Finding 25 — CRITICAL: Unsafe JSON.parse in database-provider.ts — FIXED

**File:** `@claude-flow/memory/src/database-provider.ts`

Raw `JSON.parse()` was called on data retrieved from the database without error
handling. Corrupted or malicious stored data would crash the memory subsystem.

**Fix applied:** Wrapped all `JSON.parse` calls in try-catch blocks with
structured error logging and safe fallback values.

---

#### Finding 26 — HIGH: Non-Atomic File Write in database-provider.ts — FIXED

**File:** `@claude-flow/memory/src/database-provider.ts`

Database files were written directly to the target path. A crash or power loss
during write would corrupt the database with no recovery path.

**Fix applied:** Implemented atomic write pattern — write to a temporary file
in the same directory, then `fs.renameSync()` to the target path.

---

#### Finding 27 — HIGH: Unsafe JSON.parse Across Backends — FIXED

**Files:** `sqlite-provider.ts`, `sqljs-provider.ts`, `agentdb-provider.ts`

Multiple memory backends contained bare `JSON.parse()` calls on stored data.

**Fix applied:** Introduced a shared `safeParse()` helper in the security
package and replaced all bare `JSON.parse` calls across backends.

---

#### Finding 28 — HIGH: Unsafe JSON.parse in migration.ts

**File:** `migration.ts`

Migration data loaded from disk is parsed without error handling. A corrupted
migration file would crash the upgrade process with no rollback.

**Recommendation:** Wrap in try-catch, validate against a migration schema, and
abort with a clear error message rather than crashing.

---

#### Finding 29 — MEDIUM: Predictable Temp Files in rvf-event-log.ts

**File:** `rvf-event-log.ts`

Temporary event log files use predictable names based on timestamps. On shared
systems, an attacker could pre-create symlinks at the predicted paths.

**Recommendation:** Use `crypto.randomBytes(16).toString('hex')` for temp file
names or `fs.mkdtemp()` for temp directories.

---

#### Finding 30 — MEDIUM: Inconsistent Tag Validation Across Backends

**Files:** multiple memory backend files

Tag validation rules differ between SQLite, sql.js, and AgentDB backends.
Tags accepted by one backend may be rejected by another, causing silent data
loss on backend migration.

**Recommendation:** Centralize tag validation in a shared utility. Add
cross-backend integration tests that verify identical acceptance criteria.

---

## Security Strengths

The codebase demonstrates several mature security practices:

- **SQL parameterization** is used consistently across all database operations,
  preventing SQL injection.
- **SafeExecutor** implements a command allowlist that blocks arbitrary shell
  execution in production contexts.
- **PathValidator** includes symlink resolution and directory jail enforcement.
- **bcrypt** is used for password hashing with appropriate cost factors.
- **crypto.randomBytes** is used for token generation (not `Math.random()`).
- **Comprehensive Zod validation schemas** exist for most external-facing
  inputs, though coverage is not yet universal.

---

## Consequences

### Positive

- Six critical/high findings were remediated in this PR, reducing the
  attack surface for the upcoming v3.5.43 stable release.
- The `safeParse` helper establishes a pattern for consistent JSON handling
  across all backends.
- Atomic writes in the database provider eliminate a class of data corruption
  bugs.

### Negative

- Seven high-severity findings remain open and must be tracked in subsequent
  sprints.
- The healthcare plugin requires significant rework to meet HIPAA technical
  safeguard requirements before it can be recommended for production PHI
  workloads.

### Risks

- **Finding 1 (executor.ts command injection)** and **Finding 14
  (QESecurityBridge.ts code injection)** are the highest-risk open items.
  Both allow remote code execution if an attacker can influence hook
  parameters or scanned file content, respectively.

---

## Compliance Notes

| Standard       | Relevant Findings                | Status            |
|----------------|----------------------------------|--------------------|
| HIPAA 164.312  | #16, #17, #19, #20              | Partial — hash fixed, audit gap remains |
| SOC-2 CC6.1    | #1, #14 (injection vectors)     | Non-compliant until remediated |
| SOC-2 CC6.6    | #26 (atomic writes)             | **Compliant** (fixed) |
| OWASP Top 10   | #1, #3, #6, #14 (A03 Injection) | Open items remain  |

---

## Action Items

| Priority | Finding(s)  | Owner         | Target     |
|----------|-------------|---------------|------------|
| P0       | #1, #14     | Security Team | v3.5.44    |
| P1       | #2, #5, #7, #13, #16, #28 | Backend Team | v3.5.45 |
| P2       | #6-#11, #15, #17-#22, #25-#26, #29-#30 | Sprint backlog | 2 sprints |
| P3       | #12, #13, #23, #24, #27, #28 | Opportunistic | Ongoing |
