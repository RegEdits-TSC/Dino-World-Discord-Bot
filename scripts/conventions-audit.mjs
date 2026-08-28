// Audits docs/conventions/manifest.json against the repo it describes.
//   node scripts/conventions-audit.mjs            audit everything
//   node scripts/conventions-audit.mjs <slug>      audit one doc
//
// Checks (numbered to match the design spec, docs/superpowers/specs/
// 2026-08-28-claude-md-decomposition-design.md §5 / the task-2 brief):
//   1. Orphan          — a tracked file matches no triggerGlobs entry anywhere.
//   2. Dead glob       — a triggerGlobs entry matches no tracked file.
//   3. Unfiled rule    — a rule map id is filed in neither a doc nor alwaysCore.
//   4. Missing doc     — a doc with filed rules has no docs/conventions/<slug>.md.
//   5. Broken anchor   — a headline cites §name with no matching "## name" in the body.
//   6. Over cap        — CLAUDE.md is longer than claudeMdMaxLines.
//   7. Missing headline — a rule's id appears in no headline line of its doc.
//   8. Summarized body — a doc's body is thinner than its rules' word budget warrants.
//   9. Cross-doc anchor — a doc (or CLAUDE.md) cites §name alongside another
//      docs/conventions/<slug>.md, and that slug's file has no "## name" heading.
//
// Checks 4, 5, 7 and 8 are meaningless before a doc actually has a body: this
// project ships the manifest (task 2) long before it ships the 28 doc files
// (tasks 5-12), and checks 4/5/7/8 would otherwise fail on every doc for that
// reason alone. So: while CLAUDE.md's migration is incomplete, checks 4, 5, 7
// and 8 are skipped for any doc whose docs/conventions/<slug>.md does not yet
// exist. Once a doc's file DOES exist, 5/7/8 run against it immediately (a
// doc task lands green on its own, without waiting on the other 27), and once
// migration is complete an absent file is a real error (check 4). A doc with
// zero filed rules (only the fallback doc, "no doc claims this file yet")
// never needs a file at all, migration status notwithstanding.
//
// Checks 1, 2, 3 and 6 always run — they are not indexed by any one doc's
// file. Check 6 carries one more guard of its own, explained at its
// implementation below: it also does nothing while CLAUDE.md is still
// exactly the length the rule map recorded when it was measured, so that
// this exact audit can pass clean at the manifest's own commit, before
// task 4 (which adds the <!-- UNMIGRATED --> marker) has run at all.
//
// Check 9 runs against whatever doc files exist, but defers a reference
// whose TARGET file does not exist yet — the same migrationComplete
// predicate check 4 uses — because a doc written in task 6 may legitimately
// point at one task 11 has not written. A deferred reference is printed on
// the info line rather than dropped, so it is visible while it waits, and it
// becomes a hard error the moment migration completes.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MANIFEST_PATH = 'docs/conventions/manifest.json';
const RULE_MAP_PATH = 'docs/superpowers/plans/artifacts/2026-08-28-claude-md-rule-map.json';
const CLAUDE_MD_PATH = 'CLAUDE.md';
const DOC_DIR = 'docs/conventions';
const DEFAULT_BODY_FLOOR = 0.7;
const UNMIGRATED_MARKER = 'UNMIGRATED';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Glob support needed, and no more: literal paths, "*" (any run of
// non-slash characters — a whole path segment or part of one, e.g.
// "battle-*.test.ts"), and "**" (any run of characters, crossing slashes).
// No dependency; the manifest's 200-odd globs use nothing else.
export function escapeRegexChar(ch) {
  return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function globToRegex(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i += 1;
    } else if (ch === '*') {
      pattern += '[^/]*';
    } else {
      pattern += escapeRegexChar(ch);
    }
  }
  return new RegExp(`^${pattern}$`);
}

// git ls-files always prints forward-slash, repo-relative paths, so no
// normalization is needed on this side. (The PreToolUse hook, built in a
// later task, is the side that has to fold absolute Windows backslash paths
// down to this same shape before matching against these globs.)
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0);
}

export function wordCount(text) {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function lineCount(text) {
  const lines = text.split(/\r\n|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function extractH2Headings(text) {
  const names = new Set();
  for (const line of text.split(/\r\n|\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) names.add(m[1].trim());
  }
  return names;
}

// A doc file is "## Headlines" (a bullet block, one imperative line per rule,
// each ending in a §anchor) followed by the body — full reasoning, organized
// under its own "## name" headings, one per anchor. Splits the file into the
// headline block's own text (excluded from the body-word check) and the body
// (everything else, anchors included).
export function splitDoc(content) {
  const lines = content.split(/\r\n|\n/);
  let headlinesAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Headlines\s*$/.test(lines[i])) {
      headlinesAt = i;
      break;
    }
  }
  if (headlinesAt === -1) {
    // No headline block at all: nothing to exclude, nothing to cite from.
    const bodyText = content;
    return { headlineText: '', bodyText, bodyHeadings: extractH2Headings(bodyText) };
  }
  let bodyAt = lines.length;
  for (let i = headlinesAt + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      bodyAt = i;
      break;
    }
  }
  const headlineText = lines.slice(headlinesAt + 1, bodyAt).join('\n');
  const bodyText = lines.slice(bodyAt).join('\n');
  return { headlineText, bodyText, bodyHeadings: extractH2Headings(bodyText) };
}

export function docFilePath(slug, docDir = DOC_DIR) {
  return `${docDir}/${slug}.md`;
}

export function allGlobEntries(manifest) {
  const entries = [];
  for (const doc of manifest.docs) {
    for (const glob of doc.triggerGlobs) {
      entries.push({ doc: doc.slug, glob, re: globToRegex(glob) });
    }
  }
  return entries;
}

export function checkOrphans(files, globEntries, errors) {
  for (const file of files) {
    const claimed = globEntries.some((g) => g.re.test(file));
    if (!claimed) errors.push(`[orphan] ${file} — matches no triggerGlobs entry in any doc`);
  }
}

export function checkDeadGlobs(files, globEntries, errors) {
  for (const g of globEntries) {
    const hit = files.some((f) => g.re.test(f));
    if (!hit) errors.push(`[dead-glob] ${g.doc}: "${g.glob}" matches no tracked file`);
  }
}

export function checkUnfiledRules(manifest, ruleMap, errors) {
  const filed = new Set();
  for (const doc of manifest.docs) for (const r of doc.rules) filed.add(r.id);
  for (const id of manifest.alwaysCore) filed.add(id);
  for (const rule of ruleMap.rules) {
    if (!filed.has(rule.id)) {
      errors.push(`[unfiled-rule] ${rule.id} — in the rule map but filed in neither a doc nor alwaysCore`);
    }
  }
}

// Checks 4, 5, 7 and 8 for one doc. `docDir` defaults to the real
// docs/conventions/ but is overridable so tests can point this at a
// throwaway fixture directory instead of writing into a tracked path.
export function auditDoc(doc, { ruleWordCountById, migrationComplete, errors, info, docDir = DOC_DIR }) {
  const path = docFilePath(doc.slug, docDir);
  const fileExists = existsSync(path);
  const needsFile = doc.rules.length > 0;

  if (!fileExists) {
    // Check 4: missing doc.
    if (needsFile && migrationComplete) {
      errors.push(`[missing-doc] ${doc.slug}: ${doc.rules.length} rule(s) filed but no ${path}`);
    }
    return; // nothing else to check without a body to read
  }

  const content = readFileSync(path, 'utf8');
  const { headlineText, bodyText, bodyHeadings } = splitDoc(content);

  // Check 5: broken anchor.
  const cited = new Set();
  for (const m of headlineText.matchAll(/§([A-Za-z0-9_-]+)/g)) cited.add(m[1]);
  for (const name of cited) {
    if (!bodyHeadings.has(name)) {
      errors.push(`[broken-anchor] ${doc.slug}: headline cites §${name}, no "## ${name}" heading in the body`);
    }
  }

  // Check 7: missing headline.
  for (const rule of doc.rules) {
    if (!headlineText.includes(rule.id)) {
      errors.push(`[missing-headline] ${doc.slug}: rule ${rule.id} is filed here but its id appears in no headline line`);
    }
  }

  // Check 8: summarized body. Ruling: skip any doc whose absorbed rules sum
  // to zero words — the fallback doc has no rules, so nothing to divide by.
  const expectedWords = doc.rules.reduce((sum, r) => sum + (ruleWordCountById.get(r.id) ?? 0), 0);
  if (expectedWords > 0) {
    const actualWords = wordCount(bodyText);
    const ratio = actualWords / expectedWords;
    const floor = doc.bodyFloorWaiver?.ratio ?? DEFAULT_BODY_FLOOR;
    const waivedNote = doc.bodyFloorWaiver
      ? ` (waived to ${floor}: ${doc.bodyFloorWaiver.reason})`
      : '';
    // Always printed, waived or not — a waiver only raises or lowers the
    // floor a shortfall is judged against, it never hides the measurement.
    info.push(
      `[body-ratio] ${doc.slug}: ${actualWords}/${expectedWords} words = ${ratio.toFixed(2)} (floor ${floor})${waivedNote}`
    );
    if (ratio < floor) {
      errors.push(
        `[summarized-body] ${doc.slug}: body is ${actualWords} words, ${(ratio * 100).toFixed(1)}% of the ` +
          `${expectedWords}-word budget summed from its rules — below the ${(floor * 100).toFixed(0)}% floor${waivedNote}`
      );
    }
  }
}

// Check 9: cross-doc anchor. Check 5 resolves only the anchors a doc cites in
// its OWN "## Headlines" block, against that doc's OWN "## " headings — so a
// §anchor sitting in BODY prose and naming ANOTHER doc is unverified forever.
// That gap is not hypothetical: the first such pointer written was already
// wrong (park-surface cited §park-component-default-arm, an id that exists in
// no doc and no manifest entry) and it reached review precisely because nothing
// looked at it. Deduplication is the whole point of splitting CLAUDE.md, so
// every remaining relocation task writes more of these.
//
// Pairing rule: scan a source's full text for §anchors and
// docs/conventions/<slug>.md paths in document order, and pair an anchor with a
// path when that path is the ADJACENT token — nothing else of either kind
// between them — and within PAIR_WINDOW characters, looking forward first and
// then back. Both orders occur in the real prose ("§a in `docs/…/b.md`" and
// "`docs/…/b.md`'s §a"), and a pair is routinely split across a line break, so
// this scans the joined text rather than line by line. Two shapes stay
// deliberately silent: an anchor with no path beside it is a same-doc reference
// and belongs to check 5, and a path with no anchor beside it names a whole doc,
// where there is no name to get wrong.
//
// Adjacency and a character window are NOT enough on their own, and the first
// run proved it: park-progression names schema-and-migrations.md, ends the
// sentence, and cites its own §park-target-frozen 60 characters later — paired
// backwards, that reads as a cross-doc reference to a doc that has no such
// heading. So a pair must also carry no SENTENCE BREAK between its two tokens
// (terminal punctuation followed by whitespace, or a blank line). A reference
// and the doc it names are always in one clause together; a same-doc anchor in
// the next sentence never is.
const CROSS_DOC_REF_RE = /§([A-Za-z0-9_-]+)|docs\/conventions\/([a-z0-9-]+)\.md/g;
const PAIR_WINDOW = 120;

export function crossDocRefs(text) {
  const tokens = [];
  for (const m of text.matchAll(CROSS_DOC_REF_RE)) {
    tokens.push({
      kind: m[1] === undefined ? 'doc' : 'anchor',
      value: m[1] === undefined ? m[2] : m[1],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const SENTENCE_BREAK = new RegExp('[.;!?]\\s|\\n\\s*\\n');
  const joined = (from, to) =>
    to - from <= PAIR_WINDOW && !SENTENCE_BREAK.test(text.slice(from, to));

  const refs = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'anchor') continue;
    const next = tokens[i + 1];
    if (next && next.kind === 'doc' && joined(token.end, next.start)) {
      refs.push({ anchor: token.value, slug: next.value });
      continue;
    }
    const prev = tokens[i - 1];
    if (prev && prev.kind === 'doc' && joined(prev.end, token.start)) {
      refs.push({ anchor: token.value, slug: prev.value });
    }
  }
  return refs;
}

// `sources` is [{ name, text }] — CLAUDE.md plus every doc file that exists.
export function checkCrossDocAnchors(sources, { migrationComplete, errors, info, docDir = DOC_DIR }) {
  const headingsBySlug = new Map(); // slug -> Set of headings, or null when the file is absent
  const deferred = [];
  for (const source of sources) {
    for (const { anchor, slug } of crossDocRefs(source.text)) {
      if (!headingsBySlug.has(slug)) {
        const path = docFilePath(slug, docDir);
        headingsBySlug.set(slug, existsSync(path) ? extractH2Headings(readFileSync(path, 'utf8')) : null);
      }
      const headings = headingsBySlug.get(slug);
      if (headings === null) {
        if (migrationComplete) {
          errors.push(
            `[cross-doc-anchor] ${source.name}: cites §${anchor} in docs/conventions/${slug}.md, which does not exist`
          );
        } else {
          deferred.push(`${source.name} -> ${slug}.md §${anchor}`);
        }
        continue;
      }
      if (!headings.has(anchor)) {
        errors.push(
          `[cross-doc-anchor] ${source.name}: cites §${anchor} in docs/conventions/${slug}.md, ` +
            `which has no "## ${anchor}" heading`
        );
      }
    }
  }
  if (deferred.length > 0) {
    info.push(
      `[cross-doc-deferred] ${deferred.length} cross-doc anchor(s) name a doc not written yet, ` +
        `enforced once migration completes: ${deferred.join('; ')}`
    );
  }
}

// Check 6: over cap. Skipped while CLAUDE.md still carries the
// <!-- UNMIGRATED --> marker (task 4) — that marker means "still trimming,
// still expected to be long". It is ALSO skipped for as long as CLAUDE.md is
// still EXACTLY the length the rule map recorded when it was measured
// (`source.lines` in docs/superpowers/plans/artifacts/2026-08-28-claude-md-
// rule-map.json — 1829 today): at that exact length the file is provably
// untouched since the measurement, so there is nothing yet for the cap to be
// judged against. This is deliberately NOT tied to docs/conventions/ file
// existence (an earlier version was): that guard went quiet the moment
// every doc file was deleted, which silences check 4 too — a fully broken
// repo (CLAUDE.md regrown past cap, marker stripped, every doc file gone)
// would audit clean. Comparing CLAUDE.md's own line count against the rule
// map's fixed, recorded figure can't be gamed that way — the instant anyone
// edits CLAUDE.md at all, its length stops matching 1829, and this check
// goes live on its own, independent of what docs/conventions/ holds.
export function checkOverCap(hasMarker, lines, manifest, ruleMapSourceLines, errors) {
  if (hasMarker) return;
  if (lines === ruleMapSourceLines) return;
  if (lines > manifest.claudeMdMaxLines) {
    errors.push(
      `[over-cap] CLAUDE.md is ${lines} lines, over the ${manifest.claudeMdMaxLines}-line cap, and no longer carries the UNMIGRATED marker`
    );
  }
}

// The [{ name, text }] sources check 9 scans: every doc whose file exists.
function docSources(docs, docDir = DOC_DIR) {
  const sources = [];
  for (const doc of docs) {
    const path = docFilePath(doc.slug, docDir);
    if (existsSync(path)) sources.push({ name: path, text: readFileSync(path, 'utf8') });
  }
  return sources;
}

export function main() {
  const scopeSlug = process.argv[2];

  const manifest = readJson(MANIFEST_PATH);
  const ruleMap = readJson(RULE_MAP_PATH);
  const ruleWordCountById = new Map(ruleMap.rules.map((r) => [r.id, r.wordCount]));

  const claudeMdContent = existsSync(CLAUDE_MD_PATH) ? readFileSync(CLAUDE_MD_PATH, 'utf8') : '';
  const claudeMdHasMarker = claudeMdContent.includes(UNMIGRATED_MARKER);
  const claudeMdLines = lineCount(claudeMdContent);
  const migrationComplete = !claudeMdHasMarker && claudeMdLines <= manifest.claudeMdMaxLines;

  const errors = [];
  const info = [];

  if (scopeSlug) {
    const doc = manifest.docs.find((d) => d.slug === scopeSlug);
    if (!doc) {
      console.error(`No such doc: ${scopeSlug}`);
      process.exit(1);
    }
    const files = trackedFiles();
    checkDeadGlobs(
      files,
      doc.triggerGlobs.map((glob) => ({ doc: doc.slug, glob, re: globToRegex(glob) })),
      errors
    );
    auditDoc(doc, { ruleWordCountById, migrationComplete, errors, info });
    // Check 9, scoped: only the references THIS doc makes, so a doc task still
    // lands green on its own rather than on the state of the other 28.
    checkCrossDocAnchors(docSources([doc]), { migrationComplete, errors, info });
  } else {
    const files = trackedFiles();
    const globEntries = allGlobEntries(manifest);
    checkOrphans(files, globEntries, errors);
    checkDeadGlobs(files, globEntries, errors);
    checkUnfiledRules(manifest, ruleMap, errors);
    for (const doc of manifest.docs) {
      auditDoc(doc, { ruleWordCountById, migrationComplete, errors, info });
    }
    checkOverCap(claudeMdHasMarker, claudeMdLines, manifest, ruleMap.source.lines, errors);
    // Check 9, whole repo: every doc file that exists, plus CLAUDE.md itself,
    // which points into docs/conventions/ from below the UNMIGRATED marker and
    // can name a rule just as wrongly.
    checkCrossDocAnchors(
      [{ name: CLAUDE_MD_PATH, text: claudeMdContent }, ...docSources(manifest.docs)],
      { migrationComplete, errors, info }
    );
  }

  for (const line of info) console.log(line);

  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error(`\n${errors.length} finding(s).`);
    process.exit(1);
  }

  console.log(scopeSlug ? `${scopeSlug}: clean.` : 'clean.');
  process.exit(0);
}

// Only run as a CLI when executed directly (`node scripts/conventions-audit.mjs`);
// tests/conventions.test.ts imports the check functions above without
// triggering this, so it can exercise them against fixture data instead of
// the real repo.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
