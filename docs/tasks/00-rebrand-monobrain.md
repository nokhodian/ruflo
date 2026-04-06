# Task 00: Rebrand — ruvnet→nokhodian, claude-flow/ruflo→monobrain

**Priority:** MUST RUN FIRST — before any other task  
**Effort:** Large (automated with sed/find, but requires careful verification)  
**Depends on:** nothing  
**Blocks:** everything (don't implement new features under the old name)

---

## 1. Current State

The project uses three legacy identities that must be replaced:

| Old | New | Where |
|-----|-----|-------|
| `ruvnet` | `nokhodian` | GitHub org, author fields, URLs, comments |
| `claude-flow` / `claude_flow` / `claudeflow` | `monobrain` | package names, CLI binary, npm scope base, strings |
| `ruflo` / `ruflow` | `monobrain` | npm alias package name, CLI display name, strings |
| `RuFlo` | `MonoBrain` | brand-capitalized display name |
| `Ruflo` | `Monobrain` | title-case display name |
| `@claude-flow/` | `@monobrain/` | npm org scope (all 21 packages) |
| `CLAUDE_FLOW_` | `MONOBRAIN_` | environment variable prefix (88 occurrences) |
| `.claude-flow/` | `.monobrain/` | runtime data directory (293 occurrences) |
| `claude-flow.config.json` | `monobrain.config.json` | config file name |

**Scale audit (v3/ only, excluding node_modules and v2/):**
- 367 TypeScript files with `@claude-flow` imports
- 39 `package.json` files
- 88 env var `CLAUDE_FLOW_` references
- 293 `.claude-flow` runtime directory references
- 21 npm packages under `@claude-flow/` scope
- Binary name: `claude-flow` in `v3/@claude-flow/cli/package.json`

**What NOT to rename:**
- `ANTHROPIC_API_KEY` — Anthropic's key name, not our product
- `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-opus-4-6` — model names
- `claude mcp add` — Claude Code CLI command
- `.claude/` — Claude Code's config directory (not our product name)
- `CLAUDE_CODE_*` env vars — Claude Code's env vars
- `ruv-swarm`, `ruvector`, `agentic-flow`, `agentdb`, `flow-nexus` — third-party packages
- `v2/` directory contents — legacy code, leave as-is
- `.git/` — git history

---

## 2. Gap Analysis

**Why this must be first:**
Every task from 01–48 creates new files and modifies existing ones. If run before rebranding:
- 367+ new import statements will say `@claude-flow/`
- New env vars will use `CLAUDE_FLOW_`
- New runtime paths will use `.claude-flow/`
- All new documentation will reference the wrong product name
- The `COMPLETED.md` tracker will name the old packages

After this task, all 21 packages have consistent identity. Every subsequent implementation task builds on `@monobrain/` imports from the start.

**What breaks if skipped:**
- Users will see `npx claude-flow@v3alpha` in docs instead of `npx monobrain@v3alpha`
- npm publish will publish as `@claude-flow/cli` not `@monobrain/cli`
- Environment variables will still be prefixed `CLAUDE_FLOW_` — confusing for new users
- GitHub links will point to `ruvnet/` not `nokhodian/`

---

## 3. Files to Create

| Path | Purpose |
|------|---------|
| `scripts/rebrand.sh` | Master rename script (idempotent, dry-run mode) |
| `scripts/verify-rebrand.sh` | Post-run verification — checks nothing was missed |

---

## 4. Files to Modify

Everything in `v3/`, `.agents/`, `.claude/commands/`, `.claude/skills/`, `CLAUDE.md`, `CLAUDE.local.md`, `plugin/`, and top-level `package.json`. See Section 5 for exact patterns.

**Explicitly skip:**
- `v2/` — legacy directory
- `node_modules/` — never touch
- `.git/` — git internals
- `.claude/checkpoints/` — runtime data
- `.claude/settings.json` — user config (careful: only rename our product strings, not Claude Code settings keys)

---

## 5. Implementation Steps

### Step 1: Create scripts/rebrand.sh

Create this script. It must be **idempotent** (safe to run multiple times).

```bash
#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=${1:-""}
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { echo "[rebrand] $*"; }
replace() {
  local file="$1" old="$2" new="$3"
  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    grep -n "$old" "$file" | head -3 | while read line; do log "  DRY: $file: $line"; done
  else
    sed -i '' "s|$old|$new|g" "$file" 2>/dev/null || sed -i "s|$old|$new|g" "$file"
  fi
}

# Files to process: all .ts, .js, .json, .md, .sh, .yaml, .yml
# Excluding: node_modules, .git, v2/, .claude/checkpoints/
FIND_ARGS=(
  "$REPO_ROOT"
  -type f
  \( -name "*.ts" -o -name "*.js" -o -name "*.json" -o -name "*.md" \
     -o -name "*.sh" -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml" \)
  -not -path "*/node_modules/*"
  -not -path "*/.git/*"
  -not -path "*/v2/*"
  -not -path "*/.claude/checkpoints/*"
  -not -path "*/dist/*"
  -not -path "*/build/*"
)

FILES=$(find "${FIND_ARGS[@]}")
TOTAL=$(echo "$FILES" | wc -l | tr -d ' ')
log "Processing $TOTAL files (dry-run: ${DRY_RUN:-no})"

echo "$FILES" | while read -r file; do
  # Skip if file doesn't contain any target string
  grep -qE "ruvnet|claude-flow|claudeflow|claude_flow|CLAUDE_FLOW|ruflo|ruflow|RuFlo|Ruflo|@claude-flow|\\.claude-flow" \
    "$file" 2>/dev/null || continue

  log "Patching: ${file#$REPO_ROOT/}"

  # === ROUND 1: Most specific patterns first ===

  # npm org scope (import paths and package names)
  replace "$file" '@claude-flow/' '@monobrain/'

  # GitHub URLs
  replace "$file" 'github.com/ruvnet/ruflo' 'github.com/nokhodian/ruflo'
  replace "$file" 'github.com/ruvnet/claude-flow' 'github.com/nokhodian/monobrain'
  replace "$file" 'github.com/ruvnet/' 'github.com/nokhodian/'

  # npm package CLI invocations (before renaming the word 'claude-flow')
  replace "$file" 'npx claude-flow@' 'npx monobrain@'
  replace "$file" 'npx @claude-flow/cli@' 'npx @monobrain/cli@'
  replace "$file" 'npx ruflo@' 'npx monobrain@'

  # Environment variable prefix
  replace "$file" 'CLAUDE_FLOW_' 'MONOBRAIN_'

  # Runtime data directory
  replace "$file" '\.claude-flow/' '.monobrain/'
  replace "$file" '"\.claude-flow"' '".monobrain"'
  replace "$file" "'\\.claude-flow'" "'.monobrain'"
  replace "$file" '`\.claude-flow`' '`.monobrain`'

  # Config file name
  replace "$file" 'claude-flow\.config\.json' 'monobrain.config.json'

  # === ROUND 2: Brand name replacements ===

  # Capitalized brand (display names in strings/docs)
  replace "$file" 'RuFlo' 'MonoBrain'
  replace "$file" 'Ruflo' 'Monobrain'
  replace "$file" 'ruflow' 'monobrain'

  # Kebab package/CLI name
  replace "$file" 'claude-flow' 'monobrain'

  # Snake/camel variants
  replace "$file" 'claude_flow' 'monobrain'
  replace "$file" 'claudeFlow' 'monobrain'
  replace "$file" 'claudeflow' 'monobrain'

  # Lowercase brand
  replace "$file" 'ruflo' 'monobrain'

  # Author/org name (do last — broad match)
  replace "$file" 'ruvnet' 'nokhodian'
done

log "Done."
```

### Step 2: Create scripts/verify-rebrand.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

check() {
  local pattern="$1" label="$2"
  local count
  count=$(grep -r "$pattern" "$REPO_ROOT" \
    --include="*.ts" --include="*.js" --include="*.json" --include="*.md" \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=v2 \
    --exclude-dir=dist --exclude-dir=build \
    -l 2>/dev/null | grep -v ".claude/checkpoints" | wc -l | tr -d ' ')
  if [[ "$count" -gt 0 ]]; then
    echo "FAIL [$count files]: $label ($pattern)"
    grep -r "$pattern" "$REPO_ROOT" \
      --include="*.ts" --include="*.json" \
      --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=v2 \
      -l 2>/dev/null | grep -v ".claude/checkpoints" | head -5
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: $label"
  fi
}

echo "=== Rebrand Verification ==="
check "@claude-flow/"        "npm org scope"
check "CLAUDE_FLOW_"         "env var prefix"
check '\.claude-flow/'       "runtime dir"
check 'npx claude-flow@'     "npx invocation"
check 'npx ruflo@'           "npx ruflo invocation"
check '"claude-flow"'        "package name string"
check '"ruflo"'              "ruflo package string"
check 'ruvnet'               "author org"
check 'RuFlo'                "brand caps"
check 'Ruflo'                "brand title"
check 'ruflow'               "ruflow variant"

# Verify new names ARE present
present() {
  local pattern="$1" label="$2"
  local count
  count=$(grep -r "$pattern" "$REPO_ROOT" \
    --include="*.ts" --include="*.json" \
    --exclude-dir=node_modules --exclude-dir=.git \
    -l 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$count" -gt 0 ]]; then
    echo "OK (present): $label"
  else
    echo "WARN: $label not found — may not have been applied"
  fi
}

echo ""
echo "=== Checking new names are present ==="
present "@monobrain/"     "@monobrain/ scope"
present "MONOBRAIN_"      "MONOBRAIN_ env vars"
present "MonoBrain"       "MonoBrain brand"
present "monobrain"       "monobrain package"

echo ""
if [[ "$ERRORS" -gt 0 ]]; then
  echo "FAILED: $ERRORS patterns still found. Re-run rebrand.sh."
  exit 1
else
  echo "ALL CHECKS PASSED"
fi
```

### Step 3: Run in dry-run mode first

```bash
chmod +x scripts/rebrand.sh scripts/verify-rebrand.sh
bash scripts/rebrand.sh --dry-run 2>&1 | head -50
```

Review the output. Confirm it's touching the right files. Look for any false positives (e.g., model name `claude-sonnet` — this should NOT be replaced because the pattern is `claude-flow` not `claude-`).

### Step 4: Run the full rebrand

```bash
bash scripts/rebrand.sh
```

### Step 5: Rename the directory structure

The package directory `v3/@claude-flow/` must be physically renamed to `v3/@monobrain/`:

```bash
# Move all packages
cd v3
cp -r @claude-flow @monobrain
# Verify the copy worked
ls @monobrain/ | wc -l

# Update all internal cross-package import paths (already done by rebrand.sh)
# But double-check tsconfig paths
grep -r "@claude-flow" @monobrain/ --include="*.json" | grep -v node_modules | head -10
```

**Important:** Do NOT delete `v3/@claude-flow/` yet. Keep it as a symlink or stub for backwards compatibility until all consumers have migrated. Add a deprecation notice to each package's `package.json`:
```json
{
  "deprecated": "Renamed to @monobrain/<package>. Use @monobrain/<package> instead."
}
```

Actually, since this is a private fork, just rename and update all internal references. Remove the old directory after verifying the build.

### Step 6: Rename the top-level package.json and binary

Read `v3/@monobrain/cli/package.json` (after directory rename) and update:

```json
{
  "name": "@monobrain/cli",
  "bin": {
    "monobrain": "./bin/cli.js",
    "claude-flow": "./bin/cli.js"
  }
}
```

Keep `claude-flow` as a bin alias for backwards compatibility during transition. Remove it after 1 month.

Also update `package.json` at the repo root:
```json
{
  "name": "monobrain",
  "description": "MonoBrain — Enterprise Claude Code AI Agent Framework"
}
```

### Step 7: Update tsconfig path mappings

Check `v3/tsconfig.json` and `v3/tsconfig.base.json` for any path aliases:

```bash
grep -r "@claude-flow" v3/tsconfig*.json
```

Update any `paths` entries from `@claude-flow/*` to `@monobrain/*`.

### Step 8: Update CLAUDE.md and CLAUDE.local.md

These files are read by Claude Code agents in every session. They must use the new names throughout:

```bash
# Check what's left
grep -c "claude-flow\|ruflo\|ruvnet" CLAUDE.md
grep -c "claude-flow\|ruflo\|ruvnet" CLAUDE.local.md
```

Run the rebrand script output on these if not already done. Then manually verify the MCP setup instructions use `monobrain` not `claude-flow`.

### Step 9: Update .agents/ skill files

```bash
grep -r "ruvnet\|claude-flow\|ruflo" .agents/ --include="*.md" -l | while read f; do
  sed -i '' 's|ruvnet|nokhodian|g; s|claude-flow|monobrain|g; s|ruflo|monobrain|g' "$f" \
  || sed -i 's|ruvnet|nokhodian|g; s|claude-flow|monobrain|g; s|ruflo|monobrain|g' "$f"
done
```

### Step 10: Update .claude/commands/ and .claude/skills/

```bash
grep -r "ruvnet\|claude-flow\|ruflo" .claude/commands/ .claude/skills/ --include="*.md" -l | while read f; do
  sed -i '' 's|ruvnet|nokhodian|g; s|claude-flow|monobrain|g; s|ruflo|monobrain|g' "$f" \
  || sed -i 's|ruvnet|nokhodian|g; s|claude-flow|monobrain|g; s|ruflo|monobrain|g' "$f"
done
```

### Step 11: Update plugin/ directory

```bash
grep -r "ruvnet\|claude-flow\|ruflo" plugin/ --include="*.json" --include="*.md" -l | while read f; do
  sed -i '' 's|ruvnet|nokhodian|g; s|claude-flow|monobrain|g; s|RuFlo|MonoBrain|g; s|ruflo|monobrain|g' "$f" \
  || sed -i 's|ruvnet|nokhodian|g; s|claude-flow|monobrain|g; s|RuFlo|MonoBrain|g; s|ruflo|monobrain|g' "$f"
done
```

### Step 12: Rename runtime config references inside source

Find all hardcoded directory names:

```bash
grep -rn '\.claude-flow' v3/@monobrain/ --include="*.ts" | grep -v node_modules | head -20
```

These should already be replaced by the script (`.claude-flow/` → `.monobrain/`). Verify.

### Step 13: Verify the build compiles

```bash
# Try building the CLI package first (catches the most cross-package import issues)
cd v3/@monobrain/cli
npm install
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Fix any TypeScript errors from missed renames before proceeding.

### Step 14: Run verification

```bash
bash scripts/verify-rebrand.sh
```

All checks should pass. Fix any remaining issues.

### Step 15: Update docs/tasks/COMPLETED.md

Add this task to the Done list.

### Step 16: Commit

```bash
git add -A
git commit -m "rebrand: ruvnet→nokhodian, claude-flow/ruflo→monobrain

- Rename all @claude-flow/* packages to @monobrain/*
- Rename CLI binary claude-flow → monobrain (with claude-flow alias)
- Rename CLAUDE_FLOW_ env vars to MONOBRAIN_
- Rename .claude-flow/ runtime dir to .monobrain/
- Replace ruvnet → nokhodian in all author/URL fields
- Replace ruflo/RuFlo → monobrain/MonoBrain display names
- Update CLAUDE.md, CLAUDE.local.md, all skill files
- Add scripts/rebrand.sh and scripts/verify-rebrand.sh

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push nokhodian main
```

---

## 6. Key Code Templates

### `scripts/rebrand.sh` — full content in Step 1 above

### Pattern priority order (critical — wrong order causes double-replacement)

```
1. @claude-flow/     → @monobrain/          (scoped imports — most specific)
2. github.com/ruvnet/ruflo → github.com/nokhodian/ruflo
3. github.com/ruvnet/claude-flow → github.com/nokhodian/monobrain
4. github.com/ruvnet/ → github.com/nokhodian/
5. npx claude-flow@  → npx monobrain@       (CLI invocations)
6. npx @claude-flow/ → npx @monobrain/
7. npx ruflo@        → npx monobrain@
8. CLAUDE_FLOW_      → MONOBRAIN_           (env vars — before renaming claude-flow)
9. .claude-flow/     → .monobrain/          (runtime dir)
10. claude-flow.config.json → monobrain.config.json
11. RuFlo            → MonoBrain            (brand caps)
12. Ruflo            → Monobrain            (title case)
13. ruflow           → monobrain
14. claude-flow      → monobrain            (kebab — after all specific patterns)
15. claude_flow      → monobrain
16. claudeFlow       → monobrain
17. claudeflow       → monobrain
18. ruflo            → monobrain            (lowercase — after RuFlo/Ruflo done)
19. ruvnet           → nokhodian            (org name — last, broad match)
```

### False-positive guards (DO NOT replace these)

```bash
# These must NOT be touched by any sed pattern:
claude-sonnet-4-6       # model name
claude-haiku-4-5        # model name
claude-opus-4-6         # model name
claude mcp add          # Claude Code CLI command
.claude/                # Claude Code config directory
CLAUDE_CODE_            # Claude Code env vars (not ours)
ANTHROPIC_              # Anthropic env vars
```

Add a guard at the top of rebrand.sh to verify these are untouched:
```bash
# After running, verify these are unchanged
grep -r "claude-sonnet" v3/ --include="*.ts" | grep -v node_modules | grep -v "monobrain" | head -3
```

---

## 7. Testing Strategy

### Automated checks (scripts/verify-rebrand.sh — see Step 2)
- 11 patterns that must be ABSENT after rebrand
- 4 patterns that must be PRESENT after rebrand

### Build test
```bash
cd v3/@monobrain/cli && npm install && npm run build 2>&1 | tail -20
```
Zero TypeScript errors = pass.

### Smoke test — CLI works
```bash
node v3/@monobrain/cli/dist/bin/cli.js --version
# Expected: 3.5.x
node v3/@monobrain/cli/dist/bin/cli.js --help
# Expected: shows "monobrain" not "claude-flow" in output
```

### Smoke test — env vars still work
```bash
MONOBRAIN_LOG_LEVEL=debug node v3/@monobrain/cli/dist/bin/cli.js status
# Should not error on unrecognized env var
```

### Smoke test — routing package imports work
```bash
node -e "import('@monobrain/routing').then(m => console.log(Object.keys(m)))" 2>/dev/null \
  || node -e "const m = require('./v3/@monobrain/routing/dist/index.js'); console.log(Object.keys(m))"
```

### Manual spot-checks
```bash
# Check CLAUDE.md
grep -c "monobrain\|nokhodian" CLAUDE.md
grep -c "claude-flow\|ruvnet\|ruflo" CLAUDE.md   # should be 0

# Check a CLI source file
grep -c "@monobrain" v3/@monobrain/cli/src/commands/route.ts
grep -c "@claude-flow" v3/@monobrain/cli/src/commands/route.ts  # should be 0

# Check env var prefix
grep -c "MONOBRAIN_" v3/@monobrain/cli/src/mcp-server.ts
grep -c "CLAUDE_FLOW_" v3/@monobrain/cli/src/mcp-server.ts  # should be 0
```

---

## 8. Definition of Done

- [ ] `bash scripts/verify-rebrand.sh` exits with `ALL CHECKS PASSED`
- [ ] `grep -r "@claude-flow/" v3/ --include="*.ts" | grep -v node_modules` returns 0 results
- [ ] `grep -r "CLAUDE_FLOW_" v3/ --include="*.ts" | grep -v node_modules` returns 0 results
- [ ] `grep -r "\.claude-flow" v3/ --include="*.ts" | grep -v node_modules` returns 0 results
- [ ] `grep -r "ruvnet" . --include="*.ts" --include="*.md" | grep -v node_modules | grep -v v2/ | grep -v .git/` returns 0 results
- [ ] `grep -r "ruflo\|RuFlo\|Ruflo" . --include="*.ts" --include="*.md" | grep -v node_modules | grep -v v2/ | grep -v .git/` returns 0 results
- [ ] `cd v3/@monobrain/cli && npm run build` completes with 0 TypeScript errors
- [ ] `node v3/@monobrain/cli/dist/bin/cli.js --version` prints the version
- [ ] `node v3/@monobrain/cli/dist/bin/cli.js --help` output contains "monobrain" not "claude-flow"
- [ ] `CLAUDE.md` contains "monobrain" and zero occurrences of "claude-flow" or "ruflo"
- [ ] `scripts/rebrand.sh` exists and is idempotent (running twice produces no changes on second run)
- [ ] `scripts/verify-rebrand.sh` exists and passes
- [ ] `v3/@monobrain/` directory exists with all 21 packages
- [ ] `docs/tasks/COMPLETED.md` updated with this task
- [ ] Committed and pushed to `nokhodian/ruflo` with the rebrand commit message format above
