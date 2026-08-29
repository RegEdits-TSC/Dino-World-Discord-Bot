// Stop hook: names the operator steps this session's changes will owe once
// they merge, as a `systemMessage`.
//
// Why a second hook at all. The PreToolUse hook next door fires when a file
// is EDITED — hours or days before `deploy-emojis`, `deploy-branding`, a
// data backfill or `test:live` actually matter, and never again afterwards.
// Worse, `test:live` is triggered by `assets/images/**`, and no convention
// doc claims that path, so shipping new art currently never mentions the
// gallery at all. Only `deploy-commands` survives in CLAUDE.md's core.
// These five steps run against the live bot; nothing about editing a file
// is the moment to be told about them, and the end of a response is.
//
// `systemMessage`, NOT `hookSpecificOutput.additionalContext`. Stop fires
// after the response has finished, so there is no model context left to add
// to and the runtime does not support `additionalContext` on this event —
// a payload sent that way is silently discarded. `systemMessage` is a
// TOP-LEVEL common field and is surfaced to the user, which is the right
// audience anyway: these are operator steps, not model instructions. It is
// one string per invocation, so the whole checklist ships as one message.
//
// Ships registered but INERT, exactly as conventions.mjs does: unless
// CLAUDE_CONVENTIONS_ENABLED is exactly "1" this hook does nothing at all
// (Task 15 flips that env var on for both hooks together). Without the
// gate, committing this file would start printing operator checklists at
// the end of every response in this repo from that commit onward — the same
// blast radius the gate exists to prevent for the convention docs.
//
// A hook must never break the session it is trying to help. Exit code 2
// BLOCKS; this hook never emits it, and every failure mode below (malformed
// stdin, a directory that is not a git repo, a git binary that is missing
// or fails, an oversized diff, an unreadable state file) degrades to
// silence or to speaking again, never to an error.
//
// The glob matcher is imported from scripts/conventions-audit.mjs rather
// than reimplemented, for the same reason conventions.mjs imports it: two
// matchers in one repo eventually disagree, and the disagreement is silent.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { globToRegex } from '../../scripts/conventions-audit.mjs';

const STATE_FILE_NAME = 'session-close-hook-state.json';

// ---- the mapping ----
//
// Each entry: the repo paths that imply the step, and the one line an
// operator reads. Command plus one clause — the clause carries the ordering
// or the risk, which is the part a bare command list loses, and the long
// reasoning already lives in docs/conventions/ where it can be gone back to.
// Ordered as emitted: artwork uploads first, then the deploy that changes
// what Discord shows, then the gallery review, which renders against
// whatever is by then deployed.

const EMOJI_GLOBS = ['assets/emojis/**'];
const BRANDING_GLOBS = ['assets/branding/**'];
const SCHEMA_GLOBS = ['drizzle/**', 'src/core/db/schema.ts'];
// The contract path is `src/modules/*/embeds.ts`; `*embeds.ts` is a strict
// superset of it, so `park/alert-embeds.ts` and `daily/season-embeds.ts`
// count too. Those build real payloads with real art, and the gallery is
// the only place a human ever looks at them.
const ART_GLOBS = ['assets/images/**', 'src/modules/*/embeds.ts', 'src/modules/*/*embeds.ts'];

// "A command builder changed" is not a path, so this is a deliberate
// over-report in two layers. BUILDER_GLOBS are the files that literally
// construct a SlashCommandBuilder or decide which modules are deployed.
// BUILDER_DATA_GLOBS are the content tables those builders read their
// `addChoices` lists out of, all four verified in code:
//   PADDOCKS / FACILITIES -> src/modules/park/index.ts (kindChoices)
//   ATTRACTIONS           -> src/modules/guests/index.ts (attractionChoices)
//   FOODS                 -> src/modules/admin/index.ts
//   speciesByRarity       -> src/modules/hatchery/index.ts (mythicChoices)
// Any of those can move the deployed option set with no builder file in the
// diff at all. /dex's rarity, diet and archetype choices are NOT examples of
// this and must not be cited as such: they are hand-written literals in
// src/modules/dex/service.ts, outside src/data entirely. Under-reporting
// here leaves a live bot whose slash commands do not match its code, and
// the mismatch is silent until a player hits the option that moved;
// over-reporting costs one idempotent redeploy.
const BUILDER_GLOBS = [
  'src/modules/*/index.ts',
  'src/core/modules.ts',
  'src/core/module-list.ts',
  'src/deploy-commands.ts',
  'modules.json',
];
const BUILDER_DATA_GLOBS = ['src/data/**'];

const ONE_INSTANCE = 'one bot instance per token, or live commands drift from the code.';

const STEPS = [
  {
    id: 'build-emojis',
    globs: EMOJI_GLOBS,
    line:
      '- `npm run build-emojis` — re-render the PNGs first: the deploy hashes those bytes, so deploying ' +
      'without it ships the old art and reports success.',
  },
  {
    id: 'deploy-emojis',
    globs: EMOJI_GLOBS,
    line:
      '- `npm run deploy-emojis` — uploads only what the manifest shows changed; until it runs, emoji ' +
      'degrade to unicode with no error.',
  },
  {
    id: 'deploy-branding',
    globs: BRANDING_GLOBS,
    line:
      '- `npm run deploy-branding` — Discord allows roughly 2 per hour, hence `--avatar-only` / ' +
      '`--banner-only`; it checks the returned hash starts `a_`, or the animation was silently dropped.',
  },
  {
    id: 'migration',
    globs: SCHEMA_GLOBS,
    line:
      '- Migration applies on next boot. Any data backfill is a separate step run after it, never as ' +
      'migration SQL (a failure there blocks boot) — `npm run backfill-species-seen` is the precedent.',
  },
  {
    id: 'deploy-commands',
    globs: BUILDER_GLOBS,
    line: '- `npm run deploy-commands` — a command builder file changed; ' + ONE_INSTANCE,
  },
  {
    id: 'deploy-commands',
    globs: BUILDER_DATA_GLOBS,
    line:
      '- `npm run deploy-commands` — a src/data table changed and builders read choice lists from it ' +
      '(paddock kinds, attractions, foods, mythic species); ' + ONE_INSTANCE,
  },
  {
    id: 'test:live',
    globs: ART_GLOBS,
    line:
      '- `npm run test:live` — the only cosmetic check this art gets; REST-only, so it is safe while the ' +
      'bot is live.',
  },
];

const HEADER = 'Operator steps owed once this merges — they run against the live bot, not against a file:';

// ---- the mapping, applied ----

// Returns the owed steps in emission order, each named at most once even
// though `deploy-commands` has two entries (a builder file and a src/data
// table both owe the same command, and the more specific reason wins by
// coming first).
export function owedSteps(files) {
  const paths = files.filter((f) => typeof f === 'string' && f.length > 0);
  if (paths.length === 0) return [];
  const seen = new Set();
  const owed = [];
  for (const step of STEPS) {
    if (seen.has(step.id)) continue;
    const regexes = step.globs.map((g) => globToRegex(g));
    if (!paths.some((p) => regexes.some((re) => re.test(p)))) continue;
    seen.add(step.id);
    owed.push(step);
  }
  return owed;
}

// ---- per-session state ----
//
// Stop fires once per RESPONSE, not once per session. Without state, an
// ordinary content session — `src/data/**` is in the net, so most of them —
// would print the identical checklist after every single turn, and this
// repo's own conventions name that failure directly: a line an operator
// sees on every render is a line they stop seeing. So each step is named
// once per session, and a later turn that newly owes something still speaks.
//
// This keeps a state file of its OWN rather than sharing conventions.mjs's.
// Both hooks do read-modify-write on a single JSON object, and PreToolUse
// fires many times per turn, so a shared file would let either clobber the
// other's record. The direction that failure takes here is "print the whole
// checklist again next turn" — precisely what this state exists to prevent.

function stateFilePath(stateDir) {
  return join(stateDir, STATE_FILE_NAME);
}

// agent_id is folded in for the same reason conventions.mjs folds it in:
// session_id is shared with every subagent. Stop carries none today, in
// which case this reduces to the session id alone.
export function stateKey(sessionId, agentId) {
  return `${sessionId ?? ''}::${agentId ?? ''}`;
}

export function loadState(stateDir) {
  try {
    const path = stateFilePath(stateDir);
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A corrupt or unreadable state file degrades to "nothing said yet":
    // the checklist repeats, which is noisy, never fatal.
    return {};
  }
}

export function saveState(stateDir, state) {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFilePath(stateDir), JSON.stringify(state));
  } catch {
    // Swallowed deliberately (see loadState): a failed write just means the
    // next turn says it again.
  }
}

// ---- what the session changed ----

function git(args, cwd) {
  try {
    const out = execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      encoding: 'utf8',
      // stderr is discarded: "not a git repository" and a missing ref are
      // both expected inputs here, not failures worth surfacing.
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return out.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  } catch {
    // No git, no repo, no such ref, a diff past maxBuffer, a hung command —
    // all of it degrades to "this source contributed nothing".
    return [];
  }
}

// The merge base against whatever this repo calls its trunk. Tried in order
// so a fetched remote wins over a possibly-stale local branch; when none of
// them resolve (a fresh repo, a detached checkout with no trunk) the
// committed-work source simply contributes nothing.
function trunkMergeBase(cwd) {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const [base] = git(['merge-base', 'HEAD', ref], cwd);
    if (base) return base;
  }
  return null;
}

// Three sources, unioned, because each one alone misses a session this
// checklist exists for:
//
//   * committed branch work — a session that COMMITTED has a clean tree, and
//     `git diff --name-only HEAD` would report nothing for it. That is
//     precisely the session about to merge, i.e. the one whose operator
//     steps are about to come due.
//   * the working tree — a session still in flight, whose work is real but
//     not yet committed.
//   * untracked, non-ignored files — new art and new emoji SVGs arrive as
//     brand-new files, which `git diff` never reports in any form. Leaving
//     these out would silently exempt the single most common shape of
//     change that owes `test:live` and `deploy-emojis`.
//
// `--exclude-standard` is what keeps generated output (park.png renders,
// dist/) from triggering a deploy.
//
// Known silence, accepted: a commit the trunk ref ALREADY contains is not
// reported, because the merge base is then that commit itself. That is work
// already on trunk, whose operator steps belong to the merge that put it
// there rather than to a later session reading it back, so the omission
// fails safe.
export function changedFiles(cwd) {
  const base = trunkMergeBase(cwd);
  const committed = base ? git(['diff', '--name-only', base, 'HEAD'], cwd) : [];
  const working = git(['diff', '--name-only', 'HEAD'], cwd);
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd);
  return [...new Set([...committed, ...working, ...untracked])].map((p) => p.replace(/\\/g, '/'));
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

function run(payload) {
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // CLAUDE_CONVENTIONS_TOUCHED is the test seam, and takes precedence
  // whenever it is DEFINED — including when it is empty, which means "this
  // session touched nothing" rather than "fall back to git". Anything else
  // would make a test asking for the empty case read the real repo instead.
  const touched = process.env.CLAUDE_CONVENTIONS_TOUCHED;
  const files =
    typeof touched === 'string'
      ? touched.split(/\r?\n/).map((f) => f.trim().replace(/\\/g, '/')).filter((f) => f.length > 0)
      : changedFiles(repoRoot);

  const owed = owedSteps(files);
  if (owed.length === 0) return;

  const stateDir = process.env.CLAUDE_CONVENTIONS_STATE_DIR || tmpdir();
  const key = stateKey(payload?.session_id, payload?.agent_id);
  const state = loadState(stateDir);
  const alreadySaid = new Set(Array.isArray(state[key]) ? state[key] : []);

  const fresh = owed.filter((step) => !alreadySaid.has(step.id));
  if (fresh.length === 0) return;

  state[key] = [...alreadySaid, ...fresh.map((step) => step.id)];
  saveState(stateDir, state);

  process.stdout.write(
    JSON.stringify({
      systemMessage: [HEADER, ...fresh.map((step) => step.line)].join('\n'),
    })
  );
}

function main() {
  try {
    if (process.env.CLAUDE_CONVENTIONS_ENABLED !== '1') return;
    const raw = readStdin();
    if (raw === null) return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      // A payload this hook cannot parse is a payload it will not act on.
      return;
    }
    run(payload);
  } catch {
    // Never break the session.
  } finally {
    process.exitCode = 0;
  }
}

// Only run as a CLI when executed directly, so a future test importing the
// exported helpers above doesn't trigger a stdin read.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
