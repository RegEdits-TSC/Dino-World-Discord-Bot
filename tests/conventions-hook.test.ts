import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchDocs } from '../.claude/hooks/conventions.mjs';
import type { Manifest } from '../.claude/hooks/conventions.mjs';

const HOOK_PATH = '.claude/hooks/conventions.mjs';

function run(payload: object, env: Record<string, string | undefined> = {}): string {
  return execFileSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONVENTIONS_ENABLED: '1', ...env },
  });
}

function runRaw(input: string, env: Record<string, string | undefined> = {}): string {
  return execFileSync('node', [HOOK_PATH], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONVENTIONS_ENABLED: '1', ...env },
  });
}

const payload = (file: unknown, over: object = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: { file_path: file },
  session_id: 's1',
  ...over,
});

// ---- fixture plumbing ----
//
// No docs/conventions/<slug>.md exists yet — tasks 5-12 write the 29 real
// doc files. So every test that exercises actual injection content runs
// against a throwaway fixture manifest + fixture doc directory, mirroring
// tests/conventions.test.ts's own withFixtureDir pattern (task 2), never a
// tracked path: vitest runs test files in parallel forks, so a fixture
// staged under a real path could be observed or deleted by another file
// mid-run.
function withFixture(build: (paths: { manifestPath: string; docsDir: string; stateDir: string }) => void): void {
  const base = mkdtempSync(join(tmpdir(), 'conv-hook-fixture-'));
  try {
    const docsDir = join(base, 'docs');
    const stateDir = join(base, 'state');
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    build({ manifestPath: join(base, 'manifest.json'), docsDir, stateDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const FIXTURE_MANIFEST: Manifest = {
  version: 1,
  claudeMdMaxLines: 120,
  alwaysCore: [],
  docs: [
    {
      slug: 'fixture-solo',
      title: 'fixture solo doc',
      triggerGlobs: ['src/solo/**'],
      rules: [
        { id: 'fixture-rule-a', sourceLines: '1-1' },
        { id: 'fixture-rule-b', sourceLines: '2-2', bodyRequired: true },
      ],
    },
    {
      slug: 'fixture-solo-2',
      title: 'a second doc claiming the same path',
      triggerGlobs: ['src/solo/**'],
      rules: [{ id: 'fixture-rule-d', sourceLines: '3-3' }],
    },
    {
      slug: 'fixture-lonely',
      title: 'a doc whose body file is never written',
      triggerGlobs: ['src/lonely/**'],
      rules: [{ id: 'fixture-rule-e', sourceLines: '4-4' }],
    },
    {
      // Shares fixture-solo's glob on purpose: 107 of 849 real tracked
      // files match more than one doc, which is the normal state for all
      // of tasks 5-12, and the version of this suite before this fix round
      // never exercised a match set where one sibling has a body and
      // another doesn't. Its .md file is deliberately never written by
      // writeFixtureDocs — individual tests write it partway through when
      // they need to simulate the file "landing" mid-session.
      slug: 'fixture-lonely-overlap',
      title: 'a doc sharing a glob with fixture-solo whose body starts absent',
      triggerGlobs: ['src/solo/**'],
      rules: [{ id: 'fixture-rule-g', sourceLines: '6-6' }],
    },
    {
      slug: 'fixture-toplevel',
      title: 'a non-fallback doc that overlaps the fallback glob',
      triggerGlobs: ['src/*.ts'],
      rules: [{ id: 'fixture-rule-f', sourceLines: '5-5' }],
    },
    {
      slug: 'fixture-fallback',
      title: 'fixture fallback',
      fallback: true,
      triggerGlobs: ['src/*.ts', 'other/*.ts'],
      rules: [],
    },
  ],
};

function writeFixtureManifest(manifestPath: string): void {
  writeFileSync(manifestPath, JSON.stringify(FIXTURE_MANIFEST));
}

function writeFixtureDocs(docsDir: string): void {
  writeFileSync(
    join(docsDir, 'fixture-solo.md'),
    [
      '## Headlines',
      '',
      '- fixture-rule-a: HEADLINE_A_MARKER stays verbatim. §alpha',
      '- fixture-rule-b: HEADLINE_B_ONLY_MARKER must be replaced by its body. §beta',
      '',
      '## alpha',
      '',
      'Body prose for alpha, not asserted on.',
      '',
      '## beta',
      '',
      'BODY_B_MARKER is the full reasoning behind fixture-rule-b.',
      '',
    ].join('\n')
  );
  writeFileSync(
    join(docsDir, 'fixture-solo-2.md'),
    ['## Headlines', '', '- fixture-rule-d: OVERLAP_MARKER. §gamma', '', '## gamma', '', 'Overlap body prose.', ''].join(
      '\n'
    )
  );
  // fixture-lonely.md is deliberately never written.
  writeFileSync(
    join(docsDir, 'fixture-toplevel.md'),
    ['## Headlines', '', '- fixture-rule-f: TOPLEVEL_MARKER. §delta', '', '## delta', '', 'Top-level body prose.', ''].join(
      '\n'
    )
  );
  writeFileSync(
    join(docsDir, 'fixture-fallback.md'),
    ['## Headlines', '', '- fixture-fallback headline. FALLBACK_MARKER §epsilon', '', '## epsilon', '', 'Fallback body prose.', ''].join(
      '\n'
    )
  );
}

function setupFixture(paths: { manifestPath: string; docsDir: string }): void {
  writeFixtureManifest(paths.manifestPath);
  writeFixtureDocs(paths.docsDir);
}

describe('conventions hook: fixture-driven behaviour', () => {
  it('injects the doc that owns the edited file', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const out = run(payload('src/solo/thing.ts'), {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      });
      expect(out).toContain('fixture-solo');
      expect(out).toContain('docs/conventions/fixture-solo.md');
    });
  });

  it('substitutes the full body section for a bodyRequired rule instead of its headline line', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const out = run(payload('src/solo/thing.ts'), {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      });
      expect(out).toContain('HEADLINE_A_MARKER');
      expect(out).toContain('BODY_B_MARKER');
      expect(out).not.toContain('HEADLINE_B_ONLY_MARKER');
    });
  });

  it('injects every doc that matches, when a file matches more than one non-fallback doc', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const out = run(payload('src/solo/thing.ts'), {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      });
      expect(out).toContain('fixture-solo');
      expect(out).toContain('OVERLAP_MARKER');
      expect(out).toContain('docs/conventions/fixture-solo-2.md');
    });
  });

  // Controller Ruling 10: a doc whose body file is absent (renderDoc returns
  // null) and a doc whose body render genuinely throws are, prior to this
  // pair of tests, indistinguishable to the suite — main()'s outer catch
  // swallows either, and every existing assertion is `out.trim() === ''`.
  // 107 of 849 tracked files match more than one doc, which is the normal
  // state for all of tasks 5-12, so a mixed match set (one doc present, one
  // absent) is not an edge case, it is the common one.
  it('a doc with a missing body does not block a sibling doc that has one from injecting', () => {
    withFixture((paths) => {
      setupFixture(paths);
      // "src/solo/thing.ts" matches fixture-solo (has a body), fixture-solo-2
      // (has a body) and fixture-lonely-overlap (does not, yet).
      const out = run(payload('src/solo/thing.ts'), {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      });
      expect(out).toContain('fixture-solo');
      expect(out).toContain('docs/conventions/fixture-solo.md');
    });
  });

  it('a missing doc in a mixed match set is not marked seen, so it injects once its file lands', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const env = {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      };

      // First call: fixture-lonely-overlap matches alongside two docs that
      // do have bodies, but its own body doesn't exist yet.
      const first = run(payload('src/solo/thing.ts'), env);
      expect(first).toContain('fixture-solo');
      expect(first).not.toContain('LONELY_OVERLAP_LANDED_MARKER');

      // Its body "lands" mid-session.
      writeFileSync(
        join(paths.docsDir, 'fixture-lonely-overlap.md'),
        [
          '## Headlines',
          '',
          '- fixture-rule-g: LONELY_OVERLAP_LANDED_MARKER. §eta',
          '',
          '## eta',
          '',
          'Body prose that only exists once the file lands.',
          '',
        ].join('\n')
      );

      // Second call, same file, same session+agent: fixture-solo and
      // fixture-solo-2 are now deduped (their state WAS written on the
      // first call, despite the missing sibling in that same batch), and
      // fixture-lonely-overlap injects for the first time now that it has
      // a body — proving the first call never recorded it as "seen".
      const second = run(payload('src/solo/thing.ts'), env);
      expect(second).not.toContain('fixture-solo');
      expect(second).toContain('LONELY_OVERLAP_LANDED_MARKER');
    });
  });

  it('injects a doc only once per agent', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const env = {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      };
      const first = run(payload('src/solo/a.ts'), env);
      const second = run(payload('src/solo/b.ts'), env);
      expect(first).toContain('fixture-solo');
      expect(second).not.toContain('fixture-solo');
    });
  });

  it('treats a different agent in the same session as a fresh reader', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const env = {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      };
      run(payload('src/solo/a.ts'), env);
      const sub = run(payload('src/solo/a.ts', { agent_id: 'a2' }), env);
      expect(sub).toContain('fixture-solo');
    });
  });

  it('normalises an absolute Windows path to repo-relative before matching', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const absolutePath = `${process.cwd()}\\src\\solo\\thing.ts`;
      const out = run(payload(absolutePath), {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      });
      expect(out).toContain('fixture-solo');
    });
  });

  it('resolves the repo root from CLAUDE_PROJECT_DIR when set, not just process.cwd()', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const fakeRoot = mkdtempSync(join(tmpdir(), 'conv-hook-fakeroot-'));
      try {
        const absolutePath = `${fakeRoot}\\src\\solo\\thing.ts`;
        const out = run(payload(absolutePath), {
          CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
          CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
          CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
          CLAUDE_PROJECT_DIR: fakeRoot,
        });
        expect(out).toContain('fixture-solo');
      } finally {
        rmSync(fakeRoot, { recursive: true, force: true });
      }
    });
  });

  it('a doc whose body file does not exist yet is silent: no injection, no error', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const out = run(payload('src/lonely/thing.ts'), {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      });
      expect(out.trim()).toBe('');
    });
  });

  it('consults the fallback doc only when no non-fallback doc matched', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const env = {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      };
      // "src/top.ts" matches both fixture-toplevel (non-fallback) and the
      // fallback's own "src/*.ts" glob — the non-fallback doc must win and
      // the fallback must not fire alongside it.
      const overlapping = run(payload('src/top.ts'), env);
      expect(overlapping).toContain('TOPLEVEL_MARKER');
      expect(overlapping).not.toContain('FALLBACK_MARKER');

      // "other/thing.ts" matches only the fallback's second glob entry —
      // no non-fallback doc claims it, so the fallback fires.
      const fallbackOnly = run(payload('other/thing.ts'), env);
      expect(fallbackOnly).toContain('FALLBACK_MARKER');
    });
  });

  it('says nothing for a path that matches no doc at all, not even the fallback', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const out = run(payload('zzz/nomatch.xyz'), {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      });
      expect(out.trim()).toBe('');
    });
  });

  it('is inert unless explicitly enabled, even for a file a fixture doc would otherwise claim', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const out = execFileSync('node', [HOOK_PATH], {
        input: JSON.stringify(payload('src/solo/thing.ts')),
        encoding: 'utf8',
        env: {
          ...process.env,
          CLAUDE_CONVENTIONS_ENABLED: '',
          CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
          CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
          CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
        },
      });
      expect(out.trim()).toBe('');
    });
  });

  it('degrades to injecting again, never crashing, when the state file is corrupt', () => {
    withFixture((paths) => {
      setupFixture(paths);
      writeFileSync(join(paths.stateDir, 'conventions-hook-state.json'), '{not valid json');
      const out = run(payload('src/solo/thing.ts'), {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      });
      expect(out).toContain('fixture-solo');
    });
  });

  it('never fails the tool call on a malformed payload', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const env = {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      };
      expect(() => runRaw('not json', env)).not.toThrow();
      expect(() => runRaw('', env)).not.toThrow();
      expect(() => runRaw(JSON.stringify({}), env)).not.toThrow();
      expect(() => runRaw(JSON.stringify({ tool_input: {} }), env)).not.toThrow();
      expect(() => runRaw(JSON.stringify(payload(null)), env)).not.toThrow();
      expect(() => runRaw(JSON.stringify(payload(42)), env)).not.toThrow();
    });
  });

  it('an empty or missing file_path exits silently rather than injecting anything', () => {
    withFixture((paths) => {
      setupFixture(paths);
      const env = {
        CLAUDE_CONVENTIONS_MANIFEST_PATH: paths.manifestPath,
        CLAUDE_CONVENTIONS_DOCS_DIR: paths.docsDir,
        CLAUDE_CONVENTIONS_STATE_DIR: paths.stateDir,
      };
      expect(runRaw(JSON.stringify({ tool_input: {} }), env).trim()).toBe('');
      expect(runRaw(JSON.stringify({ tool_input: { file_path: '' } }), env).trim()).toBe('');
    });
  });
});

// Controller Ruling 9: the hook resolved the edited file's path against
// CLAUDE_PROJECT_DIR (or process.cwd() as a fallback), but read the
// manifest and doc bodies from bare repo-relative strings, which
// readFileSync resolves against process.cwd() only. Whenever the hook
// process's cwd differs from the project root, that manifest read throws,
// run() returns early, and the hook exits 0 with empty stdout — identical
// to the correct, designed-silence output for the whole tasks-5-12 window,
// so no existing test (including the "real-repo integration" tests just
// below, which never move cwd) could see it. .claude/settings.json itself
// invokes this script via the absolute `${CLAUDE_PROJECT_DIR}`-qualified
// path, which only makes sense on the assumption that cwd is NOT already
// the project root — so the bug contradicted the very file that wires the
// hook up.
describe('conventions hook: repo root resolution', () => {
  it('resolves the manifest and doc bodies via CLAUDE_PROJECT_DIR even when the process cwd is somewhere else entirely', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'conv-hook-fakeroot-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'conv-hook-elsewhere-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'conv-hook-state-'));
    try {
      // A fixture "repo" laid out at the DEFAULT repo-relative locations
      // (docs/conventions/manifest.json, docs/conventions/<slug>.md) under
      // fakeRoot — deliberately no CLAUDE_CONVENTIONS_MANIFEST_PATH or
      // CLAUDE_CONVENTIONS_DOCS_DIR override, since those would bypass the
      // exact default-path-resolution code path this test exists to check.
      const fakeDocsDir = join(fakeRoot, 'docs', 'conventions');
      mkdirSync(fakeDocsDir, { recursive: true });
      writeFileSync(join(fakeDocsDir, 'manifest.json'), JSON.stringify(FIXTURE_MANIFEST));
      writeFixtureDocs(fakeDocsDir);

      const absoluteHookPath = join(process.cwd(), HOOK_PATH);
      const out = execFileSync('node', [absoluteHookPath], {
        input: JSON.stringify(payload('src/solo/thing.ts')),
        encoding: 'utf8',
        cwd: elsewhere,
        env: {
          ...process.env,
          CLAUDE_CONVENTIONS_ENABLED: '1',
          CLAUDE_PROJECT_DIR: fakeRoot,
          CLAUDE_CONVENTIONS_STATE_DIR: stateDir,
        },
      });
      expect(out).toContain('fixture-solo');
      expect(out).toContain('docs/conventions/fixture-solo.md');
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

// Controller ruling 8(c): a doc whose file does not exist yet must be silent
// in production, not just under a test accommodation. That was the state of
// the real repo while the 29 doc files were being written, and it ends with
// the last of them — every manifest doc now has a body — so the silence is
// covered at fixture level instead, by "a doc whose body file does not exist
// yet is silent" and its mixed-match sibling above. What only the real repo
// can still prove is the whole path end to end with no manifest/docsDir
// override: "LICENSE" matches the real manifest's "prose-and-specs" doc and
// nothing else (confirmed against the real triggerGlobs), so the hook must
// read that doc's real body and inject it.
describe('conventions hook: real-repo integration', () => {
  it('injects the matched doc for a real file, against the real manifest and body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-hook-state-'));
    try {
      const out = run(payload('LICENSE'), { CLAUDE_CONVENTIONS_STATE_DIR: dir });
      expect(out).toContain('docs/conventions/prose-and-specs.md');
      expect(out).toContain('specs-are-dated-records');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is inert unless explicitly enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-hook-state-'));
    try {
      const out = execFileSync('node', [HOOK_PATH], {
        input: JSON.stringify(payload('src/modules/battles/service.ts')),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_CONVENTIONS_ENABLED: '', CLAUDE_CONVENTIONS_STATE_DIR: dir },
      });
      expect(out.trim()).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Spec §5.1's fifth machine-gate criterion ("any doc in docs/conventions/
// has no trigger in .claude/settings.json") restated for this project's
// one-hook-entry design: every manifest doc must be reachable through the
// hook — for every doc, some repo path must cause the hook to select it.
// This is the criterion's home; nothing else in the repo checks it. It
// exercises the real matchDocs against the real manifest and the real
// tracked file list, so it fails the moment a doc's triggerGlobs stop
// intersecting anything reachable — including, distinctly from the audit's
// own dead-glob check, the fallback doc, which is only reachable if some
// tracked file matches its globs AND matches no non-fallback doc's globs.
describe('conventions hook: every manifest doc is reachable', () => {
  it('has, for every doc (fallback included), at least one tracked file the hook would select it for', () => {
    const manifest: Manifest = JSON.parse(readFileSync('docs/conventions/manifest.json', 'utf8'));
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => f.length > 0);

    const reachable = new Set<string>();
    for (const file of files) {
      for (const doc of matchDocs(manifest, file)) reachable.add(doc.slug);
    }

    const unreachable = manifest.docs.filter((d) => !reachable.has(d.slug)).map((d) => d.slug);
    expect(unreachable).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task 14: the session-close operator checklist (.claude/hooks/session-close.mjs)
//
// The PreToolUse hook above fires when a file is EDITED — hours or days
// before the five operator steps in this repo actually matter, and never
// again afterwards. This second hook runs at Stop instead, reads what the
// session changed, and names what is owed once the change merges.
// ---------------------------------------------------------------------------

const CLOSE_HOOK_PATH = '.claude/hooks/session-close.mjs';

// Stop fires once per RESPONSE, and the hook names each owed step only once
// per session, so every call below gets a FRESH session id — otherwise one
// test's checklist would silence the next one's. The tests that exercise
// the dedupe itself pass an explicit id and deliberately reuse it.
//
// One state dir for the whole file, never the OS tmpdir default: vitest runs
// test files in parallel forks, and the real hook's default state file would
// then be read-modify-written by several of them at once.
const CLOSE_STATE_DIR = mkdtempSync(join(tmpdir(), 'session-close-state-'));
afterAll(() => rmSync(CLOSE_STATE_DIR, { recursive: true, force: true }));

let sessionSeq = 0;
function freshSession(): string {
  return `s${process.pid}-${++sessionSeq}`;
}

function stopPayload(sessionId: string): string {
  return JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId });
}

// The env seam: CLAUDE_CONVENTIONS_TOUCHED stands in for the git reads, so
// the mapping can be exercised without staging changes in a real tree.
function close(
  files: string[],
  env: Record<string, string | undefined> = {},
  sessionId: string = freshSession()
): string {
  return execFileSync('node', [CLOSE_HOOK_PATH], {
    input: stopPayload(sessionId),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CONVENTIONS_ENABLED: '1',
      CLAUDE_CONVENTIONS_STATE_DIR: CLOSE_STATE_DIR,
      CLAUDE_CONVENTIONS_TOUCHED: files.join('\n'),
      ...env,
    },
  });
}

describe('session-close checklist: the mapping', () => {
  it('names deploy-emojis when an emoji SVG changed', () => {
    expect(close(['assets/emojis/svg/dw_cash.svg'])).toContain('deploy-emojis');
  });

  it('names build-emojis BEFORE deploy-emojis, because the deploy hashes the PNG bytes', () => {
    const out = close(['assets/emojis/svg/dw_cash.svg']);
    expect(out).toContain('build-emojis');
    expect(out.indexOf('build-emojis')).toBeLessThan(out.indexOf('deploy-emojis'));
  });

  it('names test:live when art or an embed changed', () => {
    expect(close(['assets/images/banners/lots.webp'])).toContain('test:live');
    expect(close(['src/modules/park/embeds.ts'])).toContain('test:live');
  });

  it('names test:live for an alert-embeds builder too, not just the bare embeds.ts name', () => {
    expect(close(['src/modules/park/alert-embeds.ts'])).toContain('test:live');
  });

  it('names deploy-branding and says why it is rate-limited', () => {
    const out = close(['assets/branding/avatar.gif']);
    expect(out).toContain('deploy-branding');
    expect(out).toContain('--avatar-only');
    // The rate limit needs its NOUN: "roughly 2 per hour" of what. An
    // earlier compression dropped it and left a bare number.
    expect(out).toMatch(/roughly 2 profile edits per hour/);
  });

  it('names the backfill as a separate manual step for a schema or migration change', () => {
    for (const file of ['drizzle/0020_something.sql', 'src/core/db/schema.ts']) {
      const out = close([file]);
      expect(out).toContain('backfill-species-seen');
      expect(out).toContain('never as migration SQL');
      expect(out).toMatch(/next boot/);
    }
  });

  // This is the one line in the whole message that names a runnable command
  // an operator should usually NOT run: backfill-species-seen is tied to
  // migration 0010, and it fires on ANY drizzle/ or schema.ts change. A
  // compression pass dropped that qualifier once, which turns the line from
  // a warning into an instruction to corrupt unrelated data.
  it('tells the operator NOT to run the backfill unless this is its migration', () => {
    const out = close(['drizzle/0021_unrelated.sql']);
    expect(out).toContain('ONLY if this migration is the one it belongs to');
    expect(out).toContain('0010');
  });

  it('names deploy-commands when a module command file changed', () => {
    for (const file of [
      'src/modules/park/index.ts',
      'src/core/modules.ts',
      'src/core/module-list.ts',
      'src/deploy-commands.ts',
      'modules.json',
    ]) {
      expect(close([file])).toContain('deploy-commands');
    }
  });

  it('names deploy-commands for a data file too, since builders read their choice lists from src/data', () => {
    // src/modules/park/index.ts builds its kind choices from PADDOCKS and
    // FACILITIES, guests/index.ts from ATTRACTIONS, admin/index.ts from
    // FOODS, hatchery/index.ts from speciesByRarity — so a data edit can
    // move the deployed option set with no builder file in the diff at all.
    // Over-report here; under-reporting leaves a live bot whose slash
    // commands do not match its code.
    const out = close(['src/data/paddocks.ts']);
    expect(out).toContain('deploy-commands');

    // The examples the operator reads have to be things that really live in
    // src/data. /dex's rarity, diet and archetype choices are NOT: they are
    // hand-written literals in src/modules/dex/service.ts, and citing them
    // would send a maintainer narrowing this net to the wrong file.
    expect(out).toContain('paddock kinds, attractions, foods, mythic species');
    expect(out).not.toMatch(/rarit|archetype/i);
  });

  it('says nothing when nothing relevant changed', () => {
    expect(close(['README.md']).trim()).toBe('');
  });

  it('says each owed step once, however many files triggered it', () => {
    const out = close([
      'assets/emojis/svg/dw_cash.svg',
      'assets/emojis/svg/dw_food.svg',
      'assets/emojis/png/dw_cash.png',
    ]);
    expect(out.match(/deploy-emojis/g)?.length).toBe(1);
  });

  // CLAUDE.md carries these as two separate rules with two separate
  // consequences: a builder change needs the deploy, and until it runs
  // Discord still advertises the old option set; separately, run exactly one
  // bot process per token, because two gateway sessions race for every
  // interaction. A compression pass welded them into "one bot instance per
  // token, or live commands drift from the code" — which asserts that the
  // drift is CAUSED by the instance count, so an operator who checks and
  // confirms a single instance can read the line as satisfied and skip the
  // deploy. That is the exact failure the line exists to prevent, and it is
  // worse than the line being absent. Pinned for BOTH variants, since they
  // are separate strings a future edit could fix one at a time.
  it('states the deploy consequence and the one-instance rule as two separate statements', () => {
    for (const file of ['src/modules/park/index.ts', 'src/data/paddocks.ts']) {
      const out = close([file]);
      expect(out).toContain('until it runs, Discord still advertises the old option set.');
      expect(out).toContain('Run exactly one bot instance per token.');
      // The welded form, in any of the shapes it could come back as.
      expect(out).not.toMatch(/per token, or/);
      expect(out).not.toMatch(/instance per token, or live commands drift/);
    }
  });

  it('says deploy-commands once, and with the builder reason, when both a builder file and a data file changed', () => {
    // The two deploy-commands entries share one step id precisely so this
    // can only ever produce one line, and the more specific reason wins.
    const out = close(['src/modules/park/index.ts', 'src/data/paddocks.ts']);
    expect(out.match(/npm run deploy-commands/g)?.length).toBe(1);
    expect(out).toContain('a command builder file changed');
  });

  // Stop runs after the response has finished, so there is no model context
  // left to add to: the event does not support
  // hookSpecificOutput.additionalContext, and a payload sent that way is
  // discarded in silence. The right field is the TOP-LEVEL systemMessage,
  // which is surfaced to the user — the correct audience for an operator
  // step in any case. An earlier revision of this suite asserted the
  // discarded shape and so enforced the bug.
  it('emits a top-level systemMessage and no hookSpecificOutput at all', () => {
    const parsed = JSON.parse(close(['assets/emojis/svg/dw_cash.svg']));
    expect(typeof parsed.systemMessage).toBe('string');
    expect(parsed.systemMessage).toContain('deploy-emojis');
    expect(parsed.hookSpecificOutput).toBeUndefined();
  });

  // As model context the long form was fine; as a terminal message to a human
  // it was a wall. What the guard actually protects is the SHAPE — one line
  // per owed step, each leading with its command — and the line count is the
  // exact part of that.
  //
  // The character caps are a backstop against a paragraph creeping back in,
  // deliberately loose, and they are NOT a budget to cut meaning to. They
  // were 220/1200 until the two `deploy-commands` consequences had to be
  // un-welded and the migration line's "do not run this" qualifier restored;
  // the honest response to a longer line was to move the number, not to drop
  // a consequence. Worst case today is 1227 chars with a 303-char migration
  // line, so these leave real headroom rather than the 8 characters the
  // previous numbers had.
  it('keeps the whole checklist readable — one line per step, each led by its command', () => {
    const parsed = JSON.parse(
      close([
        'assets/emojis/svg/dw_cash.svg',
        'assets/branding/avatar.gif',
        'drizzle/0020_x.sql',
        'src/data/paddocks.ts',
        'assets/images/banners/x.webp',
      ])
    );
    const lines = String(parsed.systemMessage).split('\n');
    expect(lines).toHaveLength(7); // header + six owed steps
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(360);
    expect(parsed.systemMessage.length).toBeLessThan(1500);

    // Every step line has the same shape, so the list scans as a list. The
    // migration line was prose without a leading command until this was
    // pinned, and read as commentary sitting among instructions.
    for (const line of lines.slice(1)) expect(line).toMatch(/^- `npm run /);
  });
});

describe('session-close checklist: never breaks the session', () => {
  it('is inert unless CLAUDE_CONVENTIONS_ENABLED is exactly "1"', () => {
    expect(close(['assets/emojis/svg/dw_cash.svg'], { CLAUDE_CONVENTIONS_ENABLED: '' }).trim()).toBe('');
    expect(close(['assets/emojis/svg/dw_cash.svg'], { CLAUDE_CONVENTIONS_ENABLED: 'true' }).trim()).toBe('');
  });

  it('exits 0 with empty stdout on malformed stdin, rather than any non-zero code', () => {
    for (const input of ['', 'not json', '[]', JSON.stringify({ hook_event_name: 'Stop' })]) {
      const res = spawnSync('node', [CLOSE_HOOK_PATH], {
        input,
        encoding: 'utf8',
        env: {
          ...process.env,
          CLAUDE_CONVENTIONS_ENABLED: '1',
          CLAUDE_CONVENTIONS_STATE_DIR: CLOSE_STATE_DIR,
          CLAUDE_CONVENTIONS_TOUCHED: 'README.md',
        },
      });
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe('');
    }
  });

  // Exit code 2 is the one code that BLOCKS on a hook; nothing this hook can
  // hit may reach it. Asserted explicitly rather than inferred from
  // execFileSync not throwing, so a future `process.exit(2)` fails loudly.
  it('never exits 2, even on the path that has something to say', () => {
    const res = spawnSync('node', [CLOSE_HOOK_PATH], {
      input: stopPayload(freshSession()),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CONVENTIONS_ENABLED: '1',
        CLAUDE_CONVENTIONS_STATE_DIR: CLOSE_STATE_DIR,
        CLAUDE_CONVENTIONS_TOUCHED: 'assets/emojis/svg/dw_cash.svg',
      },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('deploy-emojis');
  });
});

// ---- speaks once per session ----
//
// Stop fires per RESPONSE, not per session. `src/data/**` is in the builder
// net, so an ordinary content session owes deploy-commands on its very first
// turn and would otherwise reprint the identical checklist after every turn
// for the rest of the session — and a line an operator sees on every render
// is a line they stop seeing.
describe('session-close checklist: names each step once per session', () => {
  it('says nothing on a second identical invocation in the same session', () => {
    const session = freshSession();
    const first = close(['assets/emojis/svg/dw_cash.svg'], {}, session);
    const second = close(['assets/emojis/svg/dw_cash.svg'], {}, session);
    expect(first).toContain('deploy-emojis');
    expect(second.trim()).toBe('');
  });

  it('still speaks when a later turn newly owes a step, and names only the new one', () => {
    const session = freshSession();
    const first = close(['assets/emojis/svg/dw_cash.svg'], {}, session);
    expect(first).toContain('build-emojis');

    // The same emoji work, plus art this turn: only test:live is new.
    const second = close(['assets/emojis/svg/dw_cash.svg', 'assets/images/banners/x.webp'], {}, session);
    expect(second).toContain('test:live');
    expect(second).not.toContain('build-emojis');
  });

  it('treats a different session as a fresh reader', () => {
    const files = ['assets/emojis/svg/dw_cash.svg'];
    const session = freshSession();
    close(files, {}, session);
    expect(close(files, {}, session).trim()).toBe('');
    expect(close(files, {}, freshSession())).toContain('deploy-emojis');
  });

  it('degrades to speaking again, never crashing, when the state file is corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-close-corrupt-'));
    try {
      writeFileSync(join(dir, 'session-close-hook-state.json'), '{not valid json');
      const session = freshSession();
      const env = { CLAUDE_CONVENTIONS_STATE_DIR: dir };
      expect(close(['assets/emojis/svg/dw_cash.svg'], env, session)).toContain('deploy-emojis');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps its own state file, so the PreToolUse hook cannot clobber this record', () => {
    const session = freshSession();
    close(['assets/emojis/svg/dw_cash.svg'], {}, session);
    const state = JSON.parse(readFileSync(join(CLOSE_STATE_DIR, 'session-close-hook-state.json'), 'utf8'));
    expect(state[`${session}::`]).toContain('deploy-emojis');
    // The conventions hook's own file is a different name in the same dir.
    expect(existsSync(join(CLOSE_STATE_DIR, 'conventions-hook-state.json'))).toBe(false);
  });
});

// ---- the real detection source ----
//
// CLAUDE_CONVENTIONS_TOUCHED is only the test seam. In production the hook
// reads git, and what it reads is the union of three things, because each
// alone misses a session this checklist exists for:
//   * committed branch work vs the merge base — a session that COMMITTED has
//     a clean tree and is the session most likely to be about to merge;
//   * uncommitted working-tree changes vs HEAD — a session still in flight;
//   * untracked non-ignored files — new art and new emoji SVGs arrive as
//     brand-new files, which `git diff` never reports at all.
function closeInRepo(repoDir: string): { status: number | null; stdout: string } {
  const res = spawnSync('node', [CLOSE_HOOK_PATH], {
    input: stopPayload(freshSession()),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CONVENTIONS_ENABLED: '1',
      CLAUDE_PROJECT_DIR: repoDir,
      CLAUDE_CONVENTIONS_STATE_DIR: CLOSE_STATE_DIR,
      CLAUDE_CONVENTIONS_TOUCHED: undefined,
    },
  });
  return { status: res.status, stdout: res.stdout };
}

function git(repoDir: string, args: string[]): void {
  execFileSync(
    'git',
    [
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'user.name=fixture',
      // A throwaway fixture repo must not inherit the machine's signing
      // config: a commit that prompted or failed would hang or break the run.
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: repoDir, stdio: 'ignore' }
  );
}

function withRepo(build: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'session-close-repo-'));
  try {
    build(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('session-close checklist: reads the session from git', () => {
  it('sees work the session already COMMITTED on a branch, not just the dirty tree', () => {
    withRepo((dir) => {
      mkdirSync(join(dir, 'assets', 'emojis', 'svg'), { recursive: true });
      writeFileSync(join(dir, 'README.md'), 'base\n');
      git(dir, ['init', '-b', 'main']);
      git(dir, ['add', '.']);
      git(dir, ['commit', '-m', 'base']);

      git(dir, ['checkout', '-b', 'feature']);
      writeFileSync(join(dir, 'assets', 'emojis', 'svg', 'dw_new.svg'), '<svg/>\n');
      git(dir, ['add', '.']);
      git(dir, ['commit', '-m', 'add an emoji']);

      // The tree is clean now — `git diff --name-only HEAD` reports nothing.
      const { status, stdout } = closeInRepo(dir);
      expect(status).toBe(0);
      expect(stdout).toContain('deploy-emojis');
    });
  });

  it('sees uncommitted working-tree changes to a tracked file', () => {
    withRepo((dir) => {
      mkdirSync(join(dir, 'src', 'modules', 'park'), { recursive: true });
      writeFileSync(join(dir, 'src', 'modules', 'park', 'embeds.ts'), 'export const a = 1;\n');
      git(dir, ['init', '-b', 'main']);
      git(dir, ['add', '.']);
      git(dir, ['commit', '-m', 'base']);

      writeFileSync(join(dir, 'src', 'modules', 'park', 'embeds.ts'), 'export const a = 2;\n');

      const { status, stdout } = closeInRepo(dir);
      expect(status).toBe(0);
      expect(stdout).toContain('test:live');
    });
  });

  it('sees a brand-new UNTRACKED file, which git diff never reports — the shape every art drop takes', () => {
    withRepo((dir) => {
      writeFileSync(join(dir, 'README.md'), 'base\n');
      git(dir, ['init', '-b', 'main']);
      git(dir, ['add', '.']);
      git(dir, ['commit', '-m', 'base']);

      mkdirSync(join(dir, 'assets', 'images', 'banners'), { recursive: true });
      writeFileSync(join(dir, 'assets', 'images', 'banners', 'new.webp'), 'not really a webp');

      const { status, stdout } = closeInRepo(dir);
      expect(status).toBe(0);
      expect(stdout).toContain('test:live');
    });
  });

  it('ignores a file git itself ignores, so build output never triggers a deploy', () => {
    withRepo((dir) => {
      writeFileSync(join(dir, '.gitignore'), 'assets/images/\n');
      git(dir, ['init', '-b', 'main']);
      git(dir, ['add', '.']);
      git(dir, ['commit', '-m', 'base']);

      mkdirSync(join(dir, 'assets', 'images'), { recursive: true });
      writeFileSync(join(dir, 'assets', 'images', 'generated.webp'), 'x');

      const { status, stdout } = closeInRepo(dir);
      expect(status).toBe(0);
      expect(stdout.trim()).toBe('');
    });
  });

  it('degrades to silence, not an error, when the directory is not a git repo at all', () => {
    withRepo((dir) => {
      mkdirSync(join(dir, 'assets', 'emojis'), { recursive: true });
      writeFileSync(join(dir, 'assets', 'emojis', 'x.svg'), '<svg/>');
      const { status, stdout } = closeInRepo(dir);
      expect(status).toBe(0);
      expect(stdout.trim()).toBe('');
    });
  });

  // Documented silence rather than a defect: once the trunk ref already
  // contains the commit, the merge base IS that commit and the committed
  // source reports nothing. Those operator steps belong to the merge that
  // put the work on trunk, not to a later session reading it back, so the
  // omission fails safe. Pinned so a future change to the ref ladder has to
  // decide about this case deliberately.
  it('is silent about a commit the trunk ref already contains', () => {
    withRepo((dir) => {
      mkdirSync(join(dir, 'assets', 'emojis', 'svg'), { recursive: true });
      writeFileSync(join(dir, 'README.md'), 'base\n');
      git(dir, ['init', '-b', 'main']);
      git(dir, ['add', '.']);
      git(dir, ['commit', '-m', 'base']);

      writeFileSync(join(dir, 'assets', 'emojis', 'svg', 'dw_new.svg'), '<svg/>\n');
      git(dir, ['add', '.']);
      git(dir, ['commit', '-m', 'add an emoji']);
      // origin/main now points at the emoji commit, as it would after a merge.
      git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

      const { status, stdout } = closeInRepo(dir);
      expect(status).toBe(0);
      expect(stdout.trim()).toBe('');
    });
  });
});

// Registration is the other untested runtime contract, and the field-name
// defect this suite just absorbed was exactly that kind of failure: code
// that is correct on its own terms and never reached. A hook that is not
// wired into settings.json is as inert as one that writes to a field the
// runtime discards, and nothing else in the repo checks the wiring.
describe('hook registration in .claude/settings.json', () => {
  const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8'));
  const CONVENTIONS_COMMAND = 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/conventions.mjs';

  it('registers the conventions hook on PreToolUse, pointing at a script that exists', () => {
    const commands = settings.hooks.PreToolUse.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((h) => h.command)
    );
    expect(commands).toContain(CONVENTIONS_COMMAND);
    expect(existsSync('.claude/hooks/conventions.mjs')).toBe(true);
  });

  // The command being registered says nothing about WHEN the runtime calls
  // it. `matcher` is what decides that, and narrowing it — to "Bash", say —
  // leaves the hook registered, the script present, every other assertion in
  // this file green, and the injection permanently dead. The failure mode is
  // silence, which is also a legitimate output in several states this suite
  // pins, so nothing else here can tell the two apart.
  it('matches the conventions hook against the file-touching tools, not some other set', () => {
    const entry = settings.hooks.PreToolUse.find((e: { hooks: { command: string }[] }) =>
      e.hooks.some((h) => h.command === CONVENTIONS_COMMAND)
    );
    expect(entry, 'no PreToolUse entry carries the conventions hook command').toBeDefined();
    const matcher: string = entry.matcher;
    // Read as the alternation the runtime treats it as, so adding a tool or
    // reordering them stays green while dropping one does not.
    const matched = new Set(matcher.split('|'));
    for (const tool of ['Edit', 'Write', 'Read', 'MultiEdit']) {
      expect(matched, `matcher "${matcher}" no longer fires on ${tool}`).toContain(tool);
    }
  });

  // Both hooks open with `if (process.env.CLAUDE_CONVENTIONS_ENABLED !== '1')
  // return;` — the switch that kept them inert across the 30 commits that
  // moved the rules. Deleting this env block turns both of them off again,
  // and every other test in this file supplies the variable itself (see
  // `run` at the top), so none of them would notice.
  it('sets the env var both hooks gate on, to exactly the string they compare against', () => {
    expect(settings.env?.CLAUDE_CONVENTIONS_ENABLED).toBe('1');
    for (const hook of ['.claude/hooks/conventions.mjs', '.claude/hooks/session-close.mjs']) {
      expect(readFileSync(hook, 'utf8'), `${hook} no longer reads the gate`).toContain(
        "process.env.CLAUDE_CONVENTIONS_ENABLED !== '1'"
      );
    }
  });

  it('registers the session-close hook on Stop, pointing at a script that exists', () => {
    const commands = settings.hooks.Stop.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((h) => h.command)
    );
    expect(commands).toContain('node ${CLAUDE_PROJECT_DIR}/.claude/hooks/session-close.mjs');
    expect(existsSync('.claude/hooks/session-close.mjs')).toBe(true);
  });
});
