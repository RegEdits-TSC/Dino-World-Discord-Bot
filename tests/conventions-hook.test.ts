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

// Controller ruling 8(c): a doc whose file does not exist yet must be
// silent in production, not just under a test accommodation — between now
// and tasks 5-12 the hook runs against a manifest naming 29 docs, of which
// almost none have a body file yet. This is the one test that exercises
// that against the real repo, with no manifest/docsDir override: "LICENSE"
// matches the real manifest's "prose-and-specs" doc (confirmed against the
// real triggerGlobs), whose docs/conventions/prose-and-specs.md does not
// exist at this commit.
describe('conventions hook: real-repo integration', () => {
  it('is silent for a real file whose matched doc has no body yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-hook-state-'));
    try {
      const out = run(payload('LICENSE'), { CLAUDE_CONVENTIONS_STATE_DIR: dir });
      expect(out.trim()).toBe('');
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
