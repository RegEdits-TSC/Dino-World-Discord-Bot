// PreToolUse hook: injects the convention doc(s) that own the file about to
// be touched, once per (session_id, agent_id) pair, as `additionalContext`.
//
// Ships registered but INERT — every path below exits 0, and unless
// CLAUDE_CONVENTIONS_ENABLED is exactly "1" the hook does nothing at all
// (Task 15 flips that env var on for real). This is what lets the 327 rules
// this project is moving out of CLAUDE.md be relocated across many commits
// without ever firing in the repo owner's other sessions in the meantime.
//
// A hook must never break the tool call it precedes. Only exit code 2 blocks
// a tool call; this hook never emits it, and every failure mode below
// (malformed stdin, an unreadable manifest, a corrupt state file, a missing
// doc body) degrades to silence rather than to a thrown error.
//
// The glob matcher is imported from scripts/conventions-audit.mjs rather
// than reimplemented here — two matchers that quietly disagree would mean
// the audit's "every tracked file is claimed by some doc" guarantee no
// longer says anything true about what the hook actually injects.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { globToRegex, splitDoc } from '../../scripts/conventions-audit.mjs';

const DEFAULT_MANIFEST_PATH = 'docs/conventions/manifest.json';
const DEFAULT_DOCS_DIR = 'docs/conventions';
const STATE_FILE_NAME = 'conventions-hook-state.json';

// ---- pure / IO-isolated helpers, exported for direct testing ----

// Claude Code hook payloads deliver `tool_input.file_path` absolute, with
// Windows backslashes (e.g. `C:\Users\...\src\core\locks.ts`), while the
// manifest's triggerGlobs are forward-slash and repo-relative. Feeding the
// raw value to the matcher matches nothing — this step is required, not
// defensive (see docs/superpowers/plans/artifacts/2026-08-28-hook-spike-
// findings.md).
export function normalizeFilePath(rawPath, repoRoot) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) return null;
  const forward = rawPath.replace(/\\/g, '/');
  const root = String(repoRoot).replace(/\\/g, '/');
  if (forward.toLowerCase() === root.toLowerCase()) return '';
  if (forward.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    return forward.slice(root.length + 1);
  }
  // Already relative (the common shape in hand-built payloads and tests),
  // or absolute but outside the repo root entirely — strip a leading
  // separator/drive so it reads as repo-relative rather than failing to
  // match solely because of a leftover leading slash.
  return forward.replace(/^\/+/, '').replace(/^[A-Za-z]:\//, '');
}

// Match a repo-relative path against the manifest. Every non-fallback doc's
// triggerGlobs is tried; a file may match several, and all of them are
// returned. The fallback doc — the manifest's last entry, flagged
// `fallback: true` — is consulted ONLY when no non-fallback doc matched.
export function matchDocs(manifest, relPath) {
  const nonFallback = manifest.docs.filter((d) => !d.fallback);
  const fallback = manifest.docs.find((d) => d.fallback);
  const hits = nonFallback.filter((d) => d.triggerGlobs.some((g) => globToRegex(g).test(relPath)));
  if (hits.length > 0) return hits;
  if (fallback && fallback.triggerGlobs.some((g) => globToRegex(g).test(relPath))) return [fallback];
  return [];
}

export function stateKey(sessionId, agentId) {
  // Absent agent_id means the main thread. session_id is shared between the
  // main thread and every subagent it spawns while agent_id differs, so
  // keying on session alone would inject a doc into the main thread and
  // then starve every subagent of it — backwards, since implementer
  // subagents are this feature's primary consumers.
  return `${sessionId ?? ''}::${agentId ?? ''}`;
}

function stateFilePath(stateDir) {
  return join(stateDir, STATE_FILE_NAME);
}

export function loadState(stateDir) {
  try {
    const path = stateFilePath(stateDir);
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A state read that throws (corrupt file, races, permissions) degrades
    // to "nothing injected yet" — injecting again, never crashing.
    return {};
  }
}

export function saveState(stateDir, state) {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFilePath(stateDir), JSON.stringify(state));
  } catch {
    // Swallowed deliberately (see loadState above): a failed write just
    // means the next call re-injects, which is safe.
  }
}

function escapeRegexLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pulls the full "## <anchor>" section (heading through the line before the
// next "## " heading, or end of file) out of a doc's body text.
function extractSection(bodyText, anchor) {
  const lines = bodyText.split(/\r\n|\n/);
  const headingRe = new RegExp(`^##\\s+${escapeRegexLiteral(anchor)}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start, end)
    .join('\n')
    .trim();
}

// Renders one matched doc's contribution: its `## Headlines` block verbatim,
// except that a bodyRequired rule's headline LINE is replaced with the full
// body section its §anchor cites. Returns null (never throws) when the
// doc's file doesn't exist yet — this is production behaviour between now
// and the tasks that write the 29 doc files, not just a test accommodation:
// a doc naming a rule is silent, not an error, until its file lands.
export function renderDoc(doc, docsDir) {
  const path = join(docsDir, `${doc.slug}.md`);
  if (!existsSync(path)) return null;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const { headlineText, bodyText } = splitDoc(content);
  const bodyRequiredRules = doc.rules.filter((r) => r.bodyRequired);
  const outLines = [];
  for (const line of headlineText.split(/\r\n|\n/)) {
    const owner = bodyRequiredRules.find((r) => line.includes(r.id));
    if (owner) {
      const anchorMatch = /§([A-Za-z0-9_-]+)/.exec(line);
      const section = anchorMatch ? extractSection(bodyText, anchorMatch[1]) : null;
      outLines.push(section ?? line);
    } else {
      outLines.push(line);
    }
  }
  return outLines.join('\n').trim();
}

// Combines every rendered doc into the single additionalContext string. A
// doc whose file doesn't exist yet contributes nothing and is silently
// dropped, along with docs where that leaves nothing left to say. Returns
// the injected slugs alongside the text so the caller can mark exactly
// those as "seen" — a doc that produced no content is never recorded as
// injected, so it's tried again (harmlessly) the next time its glob fires.
export function buildInjection(docs, docsDir) {
  const injectedSlugs = [];
  const blocks = [];
  for (const doc of docs) {
    const rendered = renderDoc(doc, docsDir);
    if (rendered === null || rendered === '') continue;
    injectedSlugs.push(doc.slug);
    blocks.push(`## ${DEFAULT_DOCS_DIR}/${doc.slug}.md\n\n${rendered}`);
  }
  if (blocks.length === 0) return { text: '', injectedSlugs: [] };
  const text = [
    'Project conventions apply to the file you are about to touch. Follow them exactly.',
    ...blocks,
  ].join('\n\n');
  return { text, injectedSlugs };
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

function run(payload) {
  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== 'string' || filePath.length === 0) return;

  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const relPath = normalizeFilePath(filePath, repoRoot);
  if (!relPath) return;

  const manifestPath = process.env.CLAUDE_CONVENTIONS_MANIFEST_PATH || DEFAULT_MANIFEST_PATH;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return;
  }

  const matched = matchDocs(manifest, relPath);
  if (matched.length === 0) return;

  const stateDir = process.env.CLAUDE_CONVENTIONS_STATE_DIR || tmpdir();
  const key = stateKey(payload.session_id, payload.agent_id);
  const state = loadState(stateDir);
  const alreadySeen = new Set(Array.isArray(state[key]) ? state[key] : []);

  const remaining = matched.filter((d) => !alreadySeen.has(d.slug));
  if (remaining.length === 0) return;

  const docsDir = process.env.CLAUDE_CONVENTIONS_DOCS_DIR || DEFAULT_DOCS_DIR;
  const { text, injectedSlugs } = buildInjection(remaining, docsDir);
  if (text === '') return;

  state[key] = [...alreadySeen, ...injectedSlugs];
  saveState(stateDir, state);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
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
      return;
    }
    run(payload);
  } catch {
    // A hook must never break the tool call it precedes.
  } finally {
    process.exitCode = 0;
  }
}

// Only run as a CLI when executed directly; a future test importing the
// exported helpers above shouldn't trigger stdin reads or process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
