import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
