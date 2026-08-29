// Stop hook: names the operator steps this session's changes will owe once
// they merge, as `additionalContext`.
//
// Why a second hook at all. The PreToolUse hook next door fires when a file
// is EDITED — hours or days before `deploy-emojis`, `deploy-branding`, a
// data backfill or `test:live` actually matter, and never again afterwards.
// Worse, `test:live` is triggered by `assets/images/**`, and no convention
// doc claims that path, so shipping new art currently never mentions the
// gallery at all. Only `deploy-commands` survives in CLAUDE.md's core.
// These five steps run against the live bot; nothing about editing a file
// is the moment to be told about them, and the end of a session is.
//
// Ships registered but INERT, exactly as conventions.mjs does: unless
// CLAUDE_CONVENTIONS_ENABLED is exactly "1" this hook does nothing at all
// (Task 15 flips that env var on for both hooks together). Without the
// gate, committing this file would start printing operator checklists at
// the end of every session in this repo from that commit onward — the same
// blast radius the gate exists to prevent for the convention docs.
//
// A hook must never break the session it is trying to help. Exit code 2
// BLOCKS; this hook never emits it, and every failure mode below (malformed
// stdin, a directory that is not a git repo, a git binary that is missing
// or fails, an oversized diff) degrades to silence rather than an error.
//
// The glob matcher is imported from scripts/conventions-audit.mjs rather
// than reimplemented, for the same reason conventions.mjs imports it: two
// matchers in one repo eventually disagree, and the disagreement is silent.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { globToRegex } from '../../scripts/conventions-audit.mjs';

// ---- the mapping ----
//
// Each entry: the repo paths that imply the step, and the step itself. The
// text says what is owed AND why — an operator handed a bare command list
// learns nothing about ordering or risk, which is most of what these five
// steps are. Ordered as emitted: artwork uploads first, the deploy that
// changes what Discord shows next, the gallery review last, since it
// renders against whatever is by then deployed.

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
// BUILDER_DATA_GLOBS are the content files those builders read their
// `addChoices` lists out of — /dex's rarity, diet and archetype choices,
// /admin's food choices, /build's kind choices, /hatchery's mythic choices,
// /guests' attraction choices — any of which can move the deployed option
// set with no builder file in the diff at all. Under-reporting here leaves
// a live bot whose slash commands do not match its code, and the mismatch
// is silent until a player hits the option that moved; over-reporting costs
// one idempotent redeploy.
const BUILDER_GLOBS = [
  'src/modules/*/index.ts',
  'src/core/modules.ts',
  'src/core/module-list.ts',
  'src/deploy-commands.ts',
  'modules.json',
];
const BUILDER_DATA_GLOBS = ['src/data/**'];

const DEPLOY_COMMANDS_TAIL =
  'Requires exactly one running bot instance per token. Skipping it leaves a live bot whose slash ' +
  'commands do not match its code, and the mismatch is silent until a player hits the option that moved.';

const STEPS = [
  {
    id: 'build-emojis',
    globs: EMOJI_GLOBS,
    line:
      '- `npm run build-emojis` — assets/emojis/ changed. Re-renders the committed 128x128 PNGs from the ' +
      'hand-authored SVGs. It has to run BEFORE the deploy: assets/emojis/manifest.json tracks hashes of ' +
      'those PNG bytes, so deploying without rebuilding uploads the previous artwork and reports success.',
  },
  {
    id: 'deploy-emojis',
    globs: EMOJI_GLOBS,
    line:
      '- `npm run deploy-emojis` — uploads to Discord only the emojis whose manifest hash moved, so a rerun ' +
      'is cheap. Until it runs, emojiTag/rarityEmoji fall back to unicode rather than erroring, which is why ' +
      'a forgotten deploy looks like nothing at all is wrong.',
  },
  {
    id: 'deploy-branding',
    globs: BRANDING_GLOBS,
    line:
      '- `npm run deploy-branding` — assets/branding/ changed. Discord rate-limits profile edits to roughly ' +
      '2 per hour, which is the whole reason `--avatar-only` / `--banner-only` exist: budget the two runs ' +
      'rather than firing both and losing one to the limit. It asserts the returned asset hash starts with ' +
      '`a_`, Discord’s own confirmation that it stored the animation rather than a single static frame — ' +
      'without that check the failure is silent.',
  },
  {
    id: 'migration',
    globs: SCHEMA_GLOBS,
    line:
      '- Migration — drizzle/ or src/core/db/schema.ts changed. The migration itself needs no command: it ' +
      'applies on the next boot. Any DATA backfill it needs is a SEPARATE manual operator step, run AFTER ' +
      'that migration and never as migration SQL, because a failure inside migration SQL blocks boot. ' +
      '`npm run backfill-species-seen` is the worked precedent (INSERT OR IGNORE, so re-running it is safe); ' +
      'run it only if this migration is the one it belongs to.',
  },
  {
    id: 'deploy-commands',
    globs: BUILDER_GLOBS,
    line:
      '- `npm run deploy-commands` — a command builder file changed. ' + DEPLOY_COMMANDS_TAIL,
  },
  {
    id: 'deploy-commands',
    globs: BUILDER_DATA_GLOBS,
    line:
      '- `npm run deploy-commands` — a file under src/data/ changed, and builders read their `addChoices` ' +
      'lists straight out of those tables (rarities, diets, archetypes, foods, paddock kinds, attractions, ' +
      'mythic species), so the deployed option set can move with no builder file in the diff. This one ' +
      'over-reports on purpose. ' + DEPLOY_COMMANDS_TAIL,
  },
  {
    id: 'test:live',
    globs: ART_GLOBS,
    line:
      '- `npm run test:live` — art or an embed builder changed. It posts the payload gallery (every case’s ' +
      'real embeds, components and images) to TEST_CHANNEL_ID, and it is the only cosmetic check this art ' +
      'can get: nothing in the offline suite looks at a rendered embed. REST-only, so it is safe to run ' +
      'against the dev guild while the bot is live.',
  },
];

const HEADER =
  'Operator steps this session’s changes will owe. These run against the live bot and cannot be ' +
  'satisfied by editing a file, so they belong to whoever merges this, not to the edit that caused them:';

// ---- helpers ----

export function owedLines(files) {
  const paths = files.filter((f) => typeof f === 'string' && f.length > 0);
  if (paths.length === 0) return [];
  const seen = new Set();
  const lines = [];
  for (const step of STEPS) {
    if (seen.has(step.id)) continue;
    const regexes = step.globs.map((g) => globToRegex(g));
    if (!paths.some((p) => regexes.some((re) => re.test(p)))) continue;
    seen.add(step.id);
    lines.push(step.line);
  }
  return lines;
}

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

function run() {
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

  const lines = owedLines(files);
  if (lines.length === 0) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: [HEADER, ...lines].join('\n'),
      },
    })
  );
}

function main() {
  try {
    if (process.env.CLAUDE_CONVENTIONS_ENABLED !== '1') return;
    const raw = readStdin();
    if (raw === null) return;
    try {
      JSON.parse(raw);
    } catch {
      // A payload this hook cannot parse is a payload it will not act on.
      return;
    }
    run();
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
