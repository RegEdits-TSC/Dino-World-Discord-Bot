# CLAUDE.md Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a 1829-line always-loaded `CLAUDE.md` with an ~90-line tripwire core plus 29 topic docs, each injected by a `PreToolUse` hook only when a file it governs is touched.

**Architecture:** One manifest (`docs/conventions/manifest.json`) is the single source of truth mapping doc → trigger globs → rule ids. A single hook script reads it, matches the edited path, and injects that doc's headline block once per agent. A vitest gate enforces the manifest's own invariants: no orphaned file, no dead glob, every rule filed, every anchor resolving, `CLAUDE.md` under cap.

**Tech Stack:** Node 22+ ESM (`.mjs` for the hook, outside the TypeScript build), vitest, Claude Code `PreToolUse`/`Stop` hooks, `.claude/settings.json`.

**Spec:** `docs/superpowers/specs/2026-08-28-claude-md-decomposition-design.md`

**Input artifact:** `docs/superpowers/plans/artifacts/2026-08-28-claude-md-rule-map.json` — the measured rule map: 28 docs with trigger globs, 8 always-core rules, and all 335 rules with `id`, `doc`, `sourceLines`, `summary` and `compressible`. Every task below reads it. It is the RAW measured partition; the spec's §5 amendments are applied in Task 2 as a reviewable diff.

## Global Constraints

- **This plan changes no file under `src/`.** No migration, no `npm run deploy-commands`, no emoji deploy, no bot restart. If a task finds itself editing `src/`, it has gone wrong.
- **Source of all prose is `CLAUDE.md` at commit `1b92fac`.** Read passages with `git show 1b92fac:CLAUDE.md`. Line numbers in the rule map refer to that revision and do not move as `CLAUDE.md` shrinks.
- **Move, never copy.** A passage lives in exactly one place at all times. After a doc task, its source lines are gone from `CLAUDE.md`.
- **Every rule and every load-bearing *why* survives.** Cut only: a principle restated at a site that is not its home (replace with a one-line cross-reference, keeping any clause unique to that site), and correction history whose wrong belief nobody could plausibly re-derive.
- **Never weaken a check to make it pass.** The gate exists because the growth this fixes was unenforced.
- **No attribution of any kind** in commits, docs, or file contents.
- `npm test`, `npm run typecheck`, `npm run build` stay green at every commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/conventions/manifest.json` | doc → globs → rule ids; the only mapping |
| `docs/conventions/<slug>.md` × 29 | headline block + body, one per doc |
| `.claude/hooks/conventions.mjs` | path → doc match, once-per-agent injection |
| `.claude/hooks/session-close.mjs` | operator-step checklist on `Stop` |
| `.claude/settings.json` | two hook registrations (checked in) |
| `scripts/conventions-audit.mjs` | CLI audit used by every doc task and the gate |
| `tests/conventions.test.ts` | the machine gate |
| `CLAUDE.md` | 8 tripwires + index, ~90 lines |

**Deviation from spec §3.1, deliberate:** the spec sketched one hook entry per doc using `if: "Edit(<glob>)"`. This plan registers **one** entry with no `if` and does the matching inside the script against the manifest. Two reasons: the globs then live in exactly one place instead of being duplicated into `settings.json`, and it removes the spec's stated risk that permission-rule glob syntax mishandles `src/modules/*/index.ts` or Windows path separators. Task 1 still proves the per-file firing behaviour, which the saving depends on.

---

### Task 1: Spike — prove the hook mechanism before building on it

**This is a gate.** The entire design rests on `PreToolUse` firing once per file per tool call, carrying `additionalContext` into the model, and firing inside subagents. Nothing has proved it. If any of the three fails, STOP and report — the partition must be re-cut for fewer, larger units.

**Files:**
- Create (throwaway, deleted in step 6): `.claude/hooks/spike.mjs`
- Modify (reverted in step 6): `.claude/settings.json`

- [ ] **Step 1: Write the probe hook**

```javascript
// .claude/hooks/spike.mjs
import { appendFileSync } from 'node:fs';
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let p = {};
  try { p = JSON.parse(raw); } catch {}
  appendFileSync(
    'spike-log.txt',
    JSON.stringify({
      event: p.hook_event_name,
      tool: p.tool_name,
      file: p.tool_input?.file_path ?? null,
      session: p.session_id ?? null,
      agent: p.agent_id ?? null,
      agentType: p.agent_type ?? null,
    }) + '\n'
  );
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'SPIKE_MARKER_7F3A: hook injection reached the model.',
      },
    })
  );
});
```

- [ ] **Step 2: Register it**

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|Read",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PROJECT_DIR}/.claude/hooks/spike.mjs" }] }
    ]
  }
}
```

- [ ] **Step 3: Prove per-file firing and context injection**

Read three files in one message: `README.md`, `package.json`, `vitest.config.ts`.

```bash
cat spike-log.txt
```

Expected: **three** lines, one per file, each with the correct `file`. Confirm the string `SPIKE_MARKER_7F3A` appears in your own context — if the log has three lines but no marker reached you, `additionalContext` is not being delivered and this fails.

- [ ] **Step 4: Prove it fires inside a subagent**

```bash
: > spike-log.txt
```

Dispatch one subagent whose entire task is: "Read `docs/commands.md` and reply with its first heading."

```bash
cat spike-log.txt
```

Expected: at least one line with a non-null `agent` and `agentType`.

- [ ] **Step 5: Record the findings**

Write `docs/superpowers/plans/artifacts/2026-08-28-hook-spike-findings.md` with, verbatim: the three-line log from step 3, whether the marker reached the model, and the subagent line from step 4. State plainly whether firing is per-file or per-call.

- [ ] **Step 6: Revert the probe**

```bash
rm .claude/hooks/spike.mjs spike-log.txt
git checkout .claude/settings.json 2>/dev/null || true
git status --porcelain
```

Expected: only the findings file is new.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/artifacts/2026-08-28-hook-spike-findings.md
git commit -m "Record hook-mechanism spike findings"
```

**STOP CONDITION:** if step 3 produced fewer than three lines, or the marker never reached the model, or step 4 produced no subagent line — do not start Task 2. Report which failed.

---

### Task 2: The manifest, with the spec's amendments applied

**Files:**
- Create: `docs/conventions/manifest.json`
- Create: `scripts/conventions-audit.mjs`
- Test: `tests/conventions.test.ts`

**Interfaces:**
- Produces: `docs/conventions/manifest.json` with shape
  `{ version: 1, claudeMdMaxLines: number, alwaysCore: string[], docs: Array<{ slug, title, triggerGlobs: string[], fallback?: true, rules: Array<{ id, sourceLines, bodyRequired?: true }> }> }`
- Produces: `scripts/conventions-audit.mjs`, a CLI. `node scripts/conventions-audit.mjs` audits everything; `node scripts/conventions-audit.mjs <slug>` audits one doc. Exit 0 clean, exit 1 with findings on stderr.

- [ ] **Step 1: Write the failing gate**

```typescript
// tests/conventions.test.ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('docs/conventions/manifest.json', 'utf8'));
const ruleMap = JSON.parse(
  readFileSync('docs/superpowers/plans/artifacts/2026-08-28-claude-md-rule-map.json', 'utf8')
);

describe('conventions manifest', () => {
  it('files every rule from the measured map exactly once', () => {
    const filed = new Set<string>();
    for (const d of manifest.docs) {
      for (const r of d.rules) {
        expect(filed.has(r.id), `${r.id} filed twice`).toBe(false);
        filed.add(r.id);
      }
    }
    for (const id of manifest.alwaysCore) {
      expect(filed.has(id), `${id} in both a doc and alwaysCore`).toBe(false);
      filed.add(id);
    }
    const expected = ruleMap.rules.map((r: { id: string }) => r.id).sort();
    expect([...filed].sort()).toEqual(expected);
  });

  it('holds the always-core to eight rules', () => {
    expect(manifest.alwaysCore).toHaveLength(8);
  });

  it('marks exactly the five rules that cannot be compressed to a headline', () => {
    const flagged = manifest.docs
      .flatMap((d: { rules: { id: string; bodyRequired?: boolean }[] }) => d.rules)
      .filter((r: { bodyRequired?: boolean }) => r.bodyRequired)
      .map((r: { id: string }) => r.id)
      .sort();
    expect(flagged).toEqual(
      [
        'notify-payload-omits-attachments',
        'payload-never-shared-across-two-sends',
        'one-more-face-moves-half-the-seeds',
        'no-test-proves-a-variant-is-reachable',
        'null-prototype-catalog-maps',
        'router-guard-test-evidence',
      ].sort()
    );
  });

  it('audits clean', () => {
    expect(() => execFileSync('node', ['scripts/conventions-audit.mjs'])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/conventions.test.ts`
Expected: FAIL — `ENOENT: docs/conventions/manifest.json`.

- [ ] **Step 3: Generate the manifest from the rule map**

Derive it from `docs/superpowers/plans/artifacts/2026-08-28-claude-md-rule-map.json`: one entry per doc, carrying `slug`, `title`, `triggerGlobs`, and `rules` as `{ id, sourceLines }` taken from each rule's `sourceLines`. Set `version: 1` and `claudeMdMaxLines: 120`.

- [ ] **Step 4: Apply the spec's §5 amendments — exactly these, no others**

Amendment 5.1 — append a 29th doc, last, so it is only consulted when nothing else matched:

```json
{
  "slug": "fallback",
  "title": "No doc claims this file yet",
  "fallback": true,
  "triggerGlobs": ["src/core/*.ts", "src/data/*.ts", "src/*.ts",
                   "src/modules/*/*.ts", "scripts/*", "tests/*.ts"],
  "rules": []
}
```

Amendment 5.3 — four misfiled rules:
- add `src/core/world.ts` to `season-track.triggerGlobs` (`SEASON_EPOCH = 690` is at `src/core/world.ts:94`)
- add `drizzle/**` and `src/core/db/schema.ts` to `admin-service.triggerGlobs`
- move rule `audit-by-grepping-assetimage` from `art-resolver` to `prose-and-specs`
- add `src/modules/*/service.ts` to `daily-quests-and-stats.triggerGlobs`

Amendment 5.4 — add these nine to `embed-payload-builders.triggerGlobs`:
`src/modules/care/index.ts`, `src/modules/expeditions/index.ts`, `src/modules/hatchery/index.ts`, `src/modules/help/index.ts`, `src/modules/leaderboards/index.ts`, `src/modules/park/index.ts`, `src/modules/shop/index.ts`, `src/modules/trading/index.ts`, `src/core/notify.ts`

Amendment §3.2 — set `"bodyRequired": true` on the six rule ids listed in the test in step 1.

- [ ] **Step 5: Write the audit CLI**

`scripts/conventions-audit.mjs` reports, and exits 1 on any of:
1. **Orphan** — a tracked file (from `git ls-files`) matching no `triggerGlobs` entry in any doc.
2. **Dead glob** — a glob matching no tracked file.
3. **Unfiled rule** — a rule in the map filed in neither a doc nor `alwaysCore`.
4. **Missing doc** — a manifest doc with no `docs/conventions/<slug>.md` (skip while `rules` is empty and the file is absent, so incremental doc tasks stay green).
5. **Broken anchor** — a headline citing `§name` with no matching `## name` heading in that doc's body.
6. **Over cap** — `CLAUDE.md` longer than `claudeMdMaxLines`, once `CLAUDE.md` no longer carries the `<!-- UNMIGRATED -->` marker of Task 4.
7. **Missing headline** — a rule filed in a doc whose id appears in no headline line of that doc.

Glob support needed: `**`, `*`, and literal paths. Match against forward-slash paths as `git ls-files` emits them.

- [ ] **Step 6: Run the gate to verify it passes**

Run: `npx vitest run tests/conventions.test.ts`
Expected: PASS, 4 tests. Then `node scripts/conventions-audit.mjs` — expected: exit 0, and specifically **zero orphans across all 837 tracked files**.

- [ ] **Step 7: Commit**

```bash
git add docs/conventions/manifest.json scripts/conventions-audit.mjs tests/conventions.test.ts
git commit -m "Add the conventions manifest and its audit gate"
```

---

### Task 3: The hook

**Files:**
- Create: `.claude/hooks/conventions.mjs`
- Modify: `.claude/settings.json`
- Test: `tests/conventions-hook.test.ts`

**Interfaces:**
- Consumes: `docs/conventions/manifest.json` from Task 2.
- Produces: a hook reading the `PreToolUse` payload on stdin and writing `{hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext}}` on stdout. Silent (empty stdout, exit 0) when there is nothing to say.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/conventions-hook.test.ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(payload: object, stateDir: string): string {
  return execFileSync('node', ['.claude/hooks/conventions.mjs'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONVENTIONS_STATE_DIR: stateDir },
  });
}

const payload = (file: string, over: object = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: { file_path: file },
  session_id: 's1',
  ...over,
});

describe('conventions hook', () => {
  it('injects the doc that owns the edited file', () => {
    const out = run(payload('src/modules/battles/service.ts'), mkdtempSync(join(tmpdir(), 'c-')));
    expect(out).toContain('fights-and-duels');
    expect(out).toContain('docs/conventions/fights-and-duels.md');
  });

  it('injects a doc only once per agent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c-'));
    const first = run(payload('src/modules/battles/service.ts'), dir);
    const second = run(payload('src/modules/battles/index.ts'), dir);
    expect(first).toContain('fights-and-duels');
    expect(second).not.toContain('fights-and-duels');
  });

  it('treats a different agent in the same session as a fresh reader', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c-'));
    run(payload('src/modules/battles/service.ts'), dir);
    const sub = run(payload('src/modules/battles/service.ts', { agent_id: 'a2' }), dir);
    expect(sub).toContain('fights-and-duels');
  });

  it('says nothing for a file no doc claims beyond the fallback', () => {
    const out = run(payload('LICENSE'), mkdtempSync(join(tmpdir(), 'c-')));
    expect(out.trim()).toBe('');
  });

  it('never fails the tool call on a malformed payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c-'));
    expect(() =>
      execFileSync('node', ['.claude/hooks/conventions.mjs'], {
        input: 'not json',
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_CONVENTIONS_STATE_DIR: dir },
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/conventions-hook.test.ts`
Expected: FAIL — cannot find `.claude/hooks/conventions.mjs`.

- [ ] **Step 3: Implement the hook**

Behaviour, in order:
1. Read stdin; on any parse failure, exit 0 silently. **A hook must never break the tool call it precedes.**
2. Take `tool_input.file_path`; normalise backslashes to `/` and make it repo-relative. Missing path → exit 0.
3. Match against every non-fallback doc's `triggerGlobs`. If none match, match the `fallback` doc. A file may match several docs — inject all of them.
4. Drop any doc already injected for this `session_id` + `agent_id` (absent `agent_id` means the main thread). State lives in one JSON file under `CLAUDE_CONVENTIONS_STATE_DIR`, defaulting to the OS temp dir. **A state read or write that throws is swallowed** — degrade to injecting again, never to crashing.
5. For each remaining doc, emit its `## Headlines` block verbatim from `docs/conventions/<slug>.md`, except that a rule with `bodyRequired` contributes its full body section instead of its headline.
6. Print one `additionalContext` string; nothing to say means empty stdout and exit 0.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/conventions-hook.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register the hook**

`.claude/settings.json` — one entry, no `if`, matching the deviation recorded in File Structure:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|Read|MultiEdit",
        "hooks": [{ "type": "command",
                    "command": "node ${CLAUDE_PROJECT_DIR}/.claude/hooks/conventions.mjs" }] }
    ]
  }
}
```

Note `.claude/settings.local.json` already carries `worktree.baseRef` and is a separate file — do not merge them.

- [ ] **Step 6: Verify end to end**

Read `src/core/locks.ts`. Confirm the `escrow-and-item-moves` headlines appear in your context and that reading a second file in the same module injects nothing further.

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/conventions.mjs .claude/settings.json tests/conventions-hook.test.ts
git commit -m "Add the convention-injection hook"
```

---

### Task 4: The always-loaded core

Do this **before** any doc task, so every later task has a shrinking target and the marker the audit keys on.

**Files:**
- Modify: `CLAUDE.md`
- Test: `tests/conventions.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/conventions.test.ts`:

```typescript
describe('CLAUDE.md core', () => {
  const md = readFileSync('CLAUDE.md', 'utf8');

  it('opens with the eight tripwires', () => {
    const core = md.split('## Topics')[0];
    for (const phrase of [
      '.js', 'ctx.now()', 'ctx.rng()', 'better-sqlite3', 'deploy-commands',
      'one bot process per token', 'addChoices', 'customId', 'npm run typecheck',
    ]) {
      expect(core, `core is missing: ${phrase}`).toContain(phrase);
    }
  });

  it('indexes every doc in the manifest', () => {
    for (const d of manifest.docs) {
      expect(md, `index is missing ${d.slug}`).toContain(d.slug);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/conventions.test.ts`
Expected: FAIL on the index test — today's `CLAUDE.md` names no doc slugs.

- [ ] **Step 3: Restructure `CLAUDE.md`**

New top: `## Always true` with the eight always-core rules, each one line carrying its consequence — for `addChoices`, that it throws at builder construction, i.e. at boot, and the roster is at 52. Then `## Topics`, one line per manifest doc: slug, what it covers, when it fires. Then:

```markdown
<!-- UNMIGRATED: everything below moves to docs/conventions/ and this marker
     is deleted by the final task. Nothing may be added below this line. -->
```

…and every existing bullet, untouched, beneath it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/conventions.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md tests/conventions.test.ts
git commit -m "Add the always-true core and topic index to CLAUDE.md"
```

---

### Tasks 5-12: Write the docs

**Eight tasks, same shape.** Each writes its docs and removes exactly the passages it moved.

Rule counts below are the raw measured ones. Task 2's amendment 5.3 moves
`audit-by-grepping-assetimage` from `art-resolver` to `prose-and-specs`, so after
Task 2 the real counts are **49 for Task 8 and 34 for Task 12**. Read them from
the manifest, not from this table.

| Task | Docs | Rules |
| --- | --- | ---: |
| 5 | `router-and-registry`, `command-and-handler-surface`, `embed-payload-builders` | 57 |
| 6 | `park-surface`, `park-progression` | 51 |
| 7 | `economy-core`, `admin-service`, `admin-ledger` | 43 |
| 8 | `art-resolver`, `art-asset-files`, `park-png-renderer`, `emoji-pipeline`, `bot-profile-branding` | 50 |
| 9 | `escrow-and-item-moves`, `schema-and-migrations`, `species-and-dex` | 33 |
| 10 | `clock-comfort-and-feeding`, `timers-and-alerts`, `notify-and-runtime` | 31 |
| 11 | `fights-and-duels`, `battle-content-and-balance`, `leaderboards` | 29 |
| 12 | `season-track`, `daily-quests-and-stats`, `world-events`, `help-topics`, `test-harness-and-gates`, `prose-and-specs`, `fallback` | 33 |

**Procedure for each doc in the task:**

- [ ] **Step 1: Read your rules from source**

```bash
node -e "const m=require('./docs/conventions/manifest.json');console.log(m.docs.find(d=>d.slug===process.argv[1]).rules.map(r=>r.id+' '+r.sourceLines).join('\n'))" <slug>
git show 1b92fac:CLAUDE.md | sed -n '<start>,<end>p'
```

- [ ] **Step 2: Write `docs/conventions/<slug>.md`**

```markdown
# <Title>

Fires on: <one line naming the trigger files in prose>

## Headlines

- <imperative rule, and the consequence of breaking it>. §anchor
- ...

## <anchor>

<full passage, moved from CLAUDE.md, every why intact>
```

A headline names the rule **and what breaks**. "Always use `attach`" invites the reader to judge it; "hand-assigning `payload.files` shipped three attachment defects and is banned by `tests/images.test.ts`" does not. Every headline ends in a `§anchor` resolving to a `##` heading in the same file — the audit checks this.

A `bodyRequired` rule gets a body section and **no** headline line; the hook injects the section whole.

- [ ] **Step 3: Apply the deduplication for principles homed in this doc**

From spec §7 — state the principle once here in full; at every other site keep a one-line cross-reference plus any clause unique to that site. Homes: `schema-and-migrations` (derived-never-stored), `park-progression` (pure-read-never-writes; the frozen-denominator table), `router-and-registry` (the customId anchor table), `test-harness-and-gates` (a green suite proves nothing about a seam it cannot observe), `economy-core` (one helper, two surfaces), `art-asset-files` (`attach` appends; absent art degrades).

Keep correction history where a reader could plausibly re-derive the wrong belief — the reset-marker correction, which records that the spec's `users.createdAt` mechanism is false and shipped as dead code, **stays**.

- [ ] **Step 4: Remove the moved passages from `CLAUDE.md`**

Delete exactly the lines you moved, from below the `<!-- UNMIGRATED -->` marker. Nothing else changes.

- [ ] **Step 5: Verify**

```bash
node scripts/conventions-audit.mjs <slug>
npx vitest run tests/conventions.test.ts
```

Expected: exit 0; every rule id filed to this doc appears in a headline or a `bodyRequired` body; every anchor resolves.

- [ ] **Step 6: Check nothing was lost**

```bash
git show 1b92fac:CLAUDE.md | wc -l
wc -l CLAUDE.md docs/conventions/*.md
```

`CLAUDE.md` must have shrunk by roughly the lines you moved. A shrink much larger than the passages you moved means you deleted something you did not relocate — restore it.

- [ ] **Step 7: Commit** (once per task, after all its docs)

```bash
git add CLAUDE.md docs/conventions/
git commit -m "Move <area> conventions into docs/conventions/"
```

---

### Task 13: The portable rules, at user scope

**Files:**
- Modify: `C:\Users\Claude\.claude\CLAUDE.md` (outside the repo — nothing to commit)

- [ ] **Step 1: Append a "Rules that hold in any codebase" section**

Five rules, each with its *why*:
- Never write a derived count into prose; state the grep that produces it. A count is wrong the moment the next change lands, and wrong silently.
- A mock must forward every argument. `(kind, name) => real(kind, name)` silently drops a third argument and the test passes while exercising nothing.
- A guard nobody has watched fail is not yet a guard. Watch it fail, then make it pass.
- A parameter whose default would silently preserve stale state is required, never defaulted.
- Specs are dated records of a decision as it was made. Correct them elsewhere with an explicit "superseded" note naming the dead mechanism; never edit one in place.

- [ ] **Step 2: Verify the two rejected candidates are absent**

`no-await-between-check-and-write` and `no-test-fixtures-in-assets` must **not** appear. Both are true only of this stack — the first only because better-sqlite3 is synchronous, and at user scope it becomes actively wrong advice in any async-DB project. They stay in the repo docs.

- [ ] **Step 3: Confirm**

Report the five headings added. No commit — the file is outside the repo.

---

### Task 14: The operator-step checklist

Spec §5.2: a path hook cannot fire after a merge, so `deploy-emojis`, `deploy-branding`, `backfill-species-seen` and `test:live` currently surface hours early and never again.

**Files:**
- Create: `.claude/hooks/session-close.mjs`
- Modify: `.claude/settings.json`
- Test: `tests/conventions-hook.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```typescript
describe('session-close checklist', () => {
  function close(files: string[]): string {
    return execFileSync('node', ['.claude/hooks/session-close.mjs'], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's1' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONVENTIONS_TOUCHED: files.join('\n') },
    });
  }

  it('names deploy-emojis when an emoji SVG changed', () => {
    expect(close(['assets/emojis/svg/dw_cash.svg'])).toContain('deploy-emojis');
  });

  it('names test:live when art or an embed changed', () => {
    expect(close(['assets/images/banners/lots.webp'])).toContain('test:live');
    expect(close(['src/modules/park/embeds.ts'])).toContain('test:live');
  });

  it('says nothing when nothing relevant changed', () => {
    expect(close(['README.md']).trim()).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/conventions-hook.test.ts`
Expected: FAIL — cannot find `.claude/hooks/session-close.mjs`.

- [ ] **Step 3: Implement it**

On `Stop`, take the changed files from `CLAUDE_CONVENTIONS_TOUCHED` when set, else `git diff --name-only HEAD`. Map to owed steps:

| Changed | Owed |
| --- | --- |
| `assets/emojis/**` | `npm run build-emojis` then `npm run deploy-emojis` |
| `assets/branding/**` | `npm run deploy-branding` (rate-limited ~2/hour; `--avatar-only` / `--banner-only`) |
| `drizzle/**`, `src/core/db/schema.ts` | the migration applies on next boot; `backfill-species-seen` is a separate manual step, never migration SQL |
| `assets/images/**`, `src/modules/*/embeds.ts` | `npm run test:live` — the only cosmetic check this art can get |
| any command builder | `npm run deploy-commands` |

Emit one `additionalContext` line per owed step, nothing when none. Same never-crash discipline as Task 3.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/conventions-hook.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Register and commit**

Add a `Stop` entry to `.claude/settings.json` alongside `PreToolUse`.

```bash
git add .claude/hooks/session-close.mjs .claude/settings.json tests/conventions-hook.test.ts
git commit -m "Add the session-close operator checklist"
```

---

### Task 15: Close it out

**Files:**
- Modify: `CLAUDE.md`
- Test: `tests/conventions.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```typescript
it('has migrated everything out of CLAUDE.md', () => {
  const md = readFileSync('CLAUDE.md', 'utf8');
  expect(md).not.toContain('UNMIGRATED');
  expect(md.split('\n').length).toBeLessThanOrEqual(manifest.claudeMdMaxLines);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/conventions.test.ts`
Expected: FAIL — the marker is still present.

- [ ] **Step 3: Delete the marker and anything left under it**

Anything still there is unmigrated. Do not delete it blind: find its rule id in the map, file it, then remove it.

- [ ] **Step 4: Trace all 335 rules**

```bash
node scripts/conventions-audit.mjs
```

Expected: exit 0 — zero orphans, zero dead globs, zero unfiled rules, every anchor resolving, every filed rule appearing in a headline.

- [ ] **Step 5: Prove the injection on five representative files**

Read each, and record which docs fired: `src/modules/park/index.ts` (expect `command-and-handler-surface` + `park-surface` + `embed-payload-builders`), `src/data/species/allosaurus.ts` (`species-and-dex`), `drizzle/0019_*.sql` (`schema-and-migrations`), `assets/emojis/svg/dw_cash.svg` (`emoji-pipeline`), and a file you create at `src/core/scratch-probe.ts` (`fallback` — then delete it).

- [ ] **Step 6: Full verification**

```bash
npm run typecheck && npm test && npm run build
git diff --stat 1b92fac -- src/
```

Expected: all green; the `src/` diff is **empty** — this plan changes no source file.

- [ ] **Step 7: Record the outcome**

Append to the spec's §11 the measured after-figures: final `CLAUDE.md` line count, per-doc line counts, and the docs fired for each of the five files in step 5.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md tests/conventions.test.ts docs/superpowers/specs/2026-08-28-claude-md-decomposition-design.md
git commit -m "Complete the CLAUDE.md decomposition"
```

---

## Self-review notes

- **Spec coverage.** §3.1 hook → Tasks 1, 3. §3.2 headlines and the six `bodyRequired` ids → Tasks 2, 5-12. §3.3 core → Task 4. §4 partition → Task 2 manifest, Tasks 5-12 content. §5.1 fallback and gate → Task 2. §5.2 operator steps → Task 14. §5.3 misfiles and §5.4 art call sites → Task 2 step 4. §7 dedup → Task 5-12 step 3. §8 user scope → Task 13. §9 retention → the cap and index tests in Tasks 4 and 15. §11 verification → Task 15.
- **§6's stated risk is Task 1, and it is a stop condition, not a note.**
- **§10 is deliberately unimplemented** — generated files, plan-time decisions and the four under-reaching rules are recorded as known limits, not tasks. The four are named in the rule map's `knownWeaknesses`.
- **Count check.** 57+51+43+50+33+31+29+33 = 327 rules across Tasks 5-12, plus 8 in the core = 335. The one-rule shift from Task 8 to Task 12 in amendment 5.3 leaves the total unchanged.
- The `bodyRequired` list is six ids for five rules: §3.2's first item is a contradicting *pair*, and both halves need their bodies.
