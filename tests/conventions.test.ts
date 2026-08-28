import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditDoc,
  checkCrossDocAnchors,
  checkOverCap,
  crossDocRefs,
} from '../scripts/conventions-audit.mjs';
import type { ManifestDoc } from '../scripts/conventions-audit.mjs';

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

  it('marks exactly the seven rules that cannot be compressed to a headline', () => {
    // Spec §3.2 names five ITEMS, but item 2 is a matched pair naming two
    // rule ids ("one-more-face-moves-half-the-seeds" /
    // "new-face-is-inert-for-unseeded-bases") — seven ids total.
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
        'new-face-is-inert-for-unseeded-bases',
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

// Checks 4, 5, 7 and 8 skip every doc at this commit — no docs/conventions/
// doc files exist yet — and check 6 skips because CLAUDE.md is still its
// unmigrated, un-marked self. So the tests above never actually run any of
// checks 4-8's logic; an edit that silently no-op'd one of them would keep
// "audits clean" green indefinitely. These tests import the real check
// functions (not a reimplementation) and drive them directly against a
// throwaway fixture directory — never under assets/ or docs/conventions/,
// since vitest runs test files in parallel forks and a fixture staged in a
// real tracked path can be observed or deleted by another file mid-run.
describe('fixture-driven check coverage (checks 4-8, exercised directly)', () => {
  function withFixtureDir(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'conventions-audit-fixture-'));
    try {
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('check 4 (missing doc): fires once migration is complete and the file is absent, clears once it exists', () => {
    withFixtureDir((dir) => {
      const doc: ManifestDoc = {
        slug: 'fixture-doc',
        title: 'fixture',
        triggerGlobs: [],
        rules: [{ id: 'fixture-rule', sourceLines: '1-1' }],
      };
      const ruleWordCountById = new Map([['fixture-rule', 5]]);

      let errors: string[] = [];
      auditDoc(doc, { ruleWordCountById, migrationComplete: true, errors, info: [], docDir: dir });
      expect(errors.some((e) => e.startsWith('[missing-doc]'))).toBe(true);

      writeFileSync(
        join(dir, 'fixture-doc.md'),
        ['## Headlines', '', '- fixture-rule headline. §fixture', '', '## fixture', '', 'Body prose.', ''].join('\n')
      );
      errors = [];
      auditDoc(doc, { ruleWordCountById, migrationComplete: true, errors, info: [], docDir: dir });
      expect(errors.some((e) => e.startsWith('[missing-doc]'))).toBe(false);
    });
  });

  it('check 4 stays quiet on an absent file while migration is incomplete', () => {
    withFixtureDir((dir) => {
      const doc: ManifestDoc = {
        slug: 'fixture-doc',
        title: 'fixture',
        triggerGlobs: [],
        rules: [{ id: 'fixture-rule', sourceLines: '1-1' }],
      };
      const errors: string[] = [];
      auditDoc(doc, {
        ruleWordCountById: new Map([['fixture-rule', 5]]),
        migrationComplete: false,
        errors,
        info: [],
        docDir: dir,
      });
      expect(errors).toEqual([]);
    });
  });

  it('check 5 (broken anchor): fires on a §name with no matching body heading, clears once the heading exists', () => {
    withFixtureDir((dir) => {
      const doc: ManifestDoc = {
        slug: 'fixture-doc',
        title: 'fixture',
        triggerGlobs: [],
        rules: [{ id: 'fixture-rule', sourceLines: '1-1' }],
      };
      const ruleWordCountById = new Map([['fixture-rule', 5]]);
      const filePath = join(dir, 'fixture-doc.md');

      writeFileSync(
        filePath,
        [
          '## Headlines',
          '',
          '- fixture-rule headline. §missing-anchor',
          '',
          '## somewhere-else',
          '',
          'Body prose that carries no heading named missing-anchor at all.',
          '',
        ].join('\n')
      );
      let errors: string[] = [];
      auditDoc(doc, { ruleWordCountById, migrationComplete: true, errors, info: [], docDir: dir });
      expect(errors.some((e) => e.startsWith('[broken-anchor]'))).toBe(true);

      writeFileSync(
        filePath,
        [
          '## Headlines',
          '',
          '- fixture-rule headline. §missing-anchor',
          '',
          '## missing-anchor',
          '',
          'Body prose that now carries the heading the headline cites.',
          '',
        ].join('\n')
      );
      errors = [];
      auditDoc(doc, { ruleWordCountById, migrationComplete: true, errors, info: [], docDir: dir });
      expect(errors.some((e) => e.startsWith('[broken-anchor]'))).toBe(false);
    });
  });

  it(
    'check 6 (over cap): fires once CLAUDE.md has moved off its measured pre-migration length and lost the ' +
      'marker; guarded against the degenerate end state of every doc file being deleted',
    () => {
      const manifest = { version: 1 as const, claudeMdMaxLines: 120, alwaysCore: [], docs: [] };

      // Still carrying the marker: no error, however far over cap.
      let errors: string[] = [];
      checkOverCap(true, 5000, manifest, 1829, errors);
      expect(errors).toEqual([]);

      // No marker, but still EXACTLY the rule map's recorded pre-migration
      // length: provably untouched since measurement, nothing to judge yet.
      // A wider "does any doc file exist" guard could not tell this apart
      // from a genuinely regressed repo with every doc file deleted.
      errors = [];
      checkOverCap(false, 1829, manifest, 1829, errors);
      expect(errors).toEqual([]);

      // No marker, length has moved off 1829, and it's over cap: fires.
      errors = [];
      checkOverCap(false, 1830, manifest, 1829, errors);
      expect(errors.some((e) => e.startsWith('[over-cap]'))).toBe(true);

      // Fixed: trimmed under the cap.
      errors = [];
      checkOverCap(false, 100, manifest, 1829, errors);
      expect(errors).toEqual([]);
    }
  );

  it('check 7 (missing headline): fires when a filed rule id is absent from the headline block, clears once present', () => {
    withFixtureDir((dir) => {
      const doc: ManifestDoc = {
        slug: 'fixture-doc',
        title: 'fixture',
        triggerGlobs: [],
        rules: [{ id: 'fixture-rule', sourceLines: '1-1' }],
      };
      const ruleWordCountById = new Map([['fixture-rule', 5]]);
      const filePath = join(dir, 'fixture-doc.md');

      writeFileSync(
        filePath,
        [
          '## Headlines',
          '',
          '- A headline that never names the rule it is supposed to cover. §fixture',
          '',
          '## fixture',
          '',
          'Body prose.',
          '',
        ].join('\n')
      );
      let errors: string[] = [];
      auditDoc(doc, { ruleWordCountById, migrationComplete: true, errors, info: [], docDir: dir });
      expect(errors.some((e) => e.startsWith('[missing-headline]'))).toBe(true);

      writeFileSync(
        filePath,
        ['## Headlines', '', '- fixture-rule: now named right here. §fixture', '', '## fixture', '', 'Body prose.', ''].join(
          '\n'
        )
      );
      errors = [];
      auditDoc(doc, { ruleWordCountById, migrationComplete: true, errors, info: [], docDir: dir });
      expect(errors.some((e) => e.startsWith('[missing-headline]'))).toBe(false);
    });
  });

  it(
    'check 8 (summarized body): fires under the floor and clears once padded; a waiver moves the floor without ' +
      'hiding the measurement; a zero-word doc is skipped entirely',
    () => {
      withFixtureDir((dir) => {
        const doc: ManifestDoc = {
          slug: 'fixture-doc',
          title: 'fixture',
          triggerGlobs: [],
          rules: [{ id: 'fixture-rule', sourceLines: '1-1' }],
        };
        const ruleWordCountById = new Map([['fixture-rule', 100]]); // 70-word floor at the 0.7 default
        const filePath = join(dir, 'fixture-doc.md');
        const shortBody = 'Ten short words make up this entire skimpy body passage now.'; // 11 words
        const longBody = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' '); // 80 words

        writeFileSync(
          filePath,
          ['## Headlines', '', '- fixture-rule headline. §fixture', '', '## fixture', '', shortBody, ''].join('\n')
        );
        let errors: string[] = [];
        let info: string[] = [];
        auditDoc(doc, { ruleWordCountById, migrationComplete: true, errors, info, docDir: dir });
        expect(errors.some((e) => e.startsWith('[summarized-body]'))).toBe(true);
        expect(info.some((line) => line.startsWith('[body-ratio] fixture-doc:'))).toBe(true);

        writeFileSync(
          filePath,
          ['## Headlines', '', '- fixture-rule headline. §fixture', '', '## fixture', '', longBody, ''].join('\n')
        );
        errors = [];
        info = [];
        auditDoc(doc, { ruleWordCountById, migrationComplete: true, errors, info, docDir: dir });
        expect(errors.some((e) => e.startsWith('[summarized-body]'))).toBe(false);
        expect(info.some((line) => line.startsWith('[body-ratio] fixture-doc:'))).toBe(true);

        // A waiver moves the floor a shortfall is judged against, but the
        // measurement is still always printed, waived or not (Ruling 2).
        const waivedDoc: ManifestDoc = {
          ...doc,
          bodyFloorWaiver: { ratio: 0.05, reason: 'deliberately thin fixture' },
        };
        writeFileSync(
          filePath,
          ['## Headlines', '', '- fixture-rule headline. §fixture', '', '## fixture', '', shortBody, ''].join('\n')
        );
        errors = [];
        info = [];
        auditDoc(waivedDoc, { ruleWordCountById, migrationComplete: true, errors, info, docDir: dir });
        expect(errors.some((e) => e.startsWith('[summarized-body]'))).toBe(false);
        expect(info.some((line) => line.includes('waived to 0.05'))).toBe(true);

        // A doc whose absorbed rules sum to zero words (the fallback doc,
        // in real data) is skipped entirely — no info line, no error, no
        // division by zero (Ruling 3).
        const zeroWordDoc: ManifestDoc = { ...doc, rules: [] };
        errors = [];
        info = [];
        auditDoc(zeroWordDoc, {
          ruleWordCountById: new Map(),
          migrationComplete: true,
          errors,
          info,
          docDir: dir,
        });
        expect(errors).toEqual([]);
        expect(info).toEqual([]);
      });
    }
  );
});

// Check 9 exists because check 5 structurally cannot see these: check 5 resolves
// only the anchors a doc cites in its OWN "## Headlines" block, against that
// doc's OWN headings, so a §anchor sitting in body prose and naming ANOTHER doc
// was unverified forever. The first such pointer written was already wrong and
// reached review for exactly that reason. These drive the real check against a
// throwaway fixture directory, never a tracked path.
describe('fixture-driven check coverage (check 9, exercised directly)', () => {
  function withFixtureDir(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'conventions-crossdoc-fixture-'));
    try {
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function writeTarget(dir: string, slug: string, heading: string): void {
    writeFileSync(
      join(dir, `${slug}.md`),
      ['## Headlines', '', `- a headline. §${heading}`, '', `## ${heading}`, '', 'Body.', ''].join('\n')
    );
  }

  it('fires on an anchor naming another doc with no such heading, clears once the heading exists', () => {
    withFixtureDir((dir) => {
      writeTarget(dir, 'target-doc', 'somewhere-else');
      const sources = [
        { name: 'source-doc.md', text: 'See `§missing-anchor` in `docs/conventions/target-doc.md`.' },
      ];

      let errors: string[] = [];
      checkCrossDocAnchors(sources, { migrationComplete: true, errors, info: [], docDir: dir });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('[cross-doc-anchor]');
      expect(errors[0]).toContain('§missing-anchor');
      expect(errors[0]).toContain('docs/conventions/target-doc.md');

      writeTarget(dir, 'target-doc', 'missing-anchor');
      errors = [];
      checkCrossDocAnchors(sources, { migrationComplete: true, errors, info: [], docDir: dir });
      expect(errors).toEqual([]);
    });
  });

  it('defers an unwritten target while migration is incomplete, and errors once it completes', () => {
    withFixtureDir((dir) => {
      const sources = [
        { name: 'source-doc.md', text: 'See `§some-anchor` in `docs/conventions/not-written-yet.md`.' },
      ];

      // Incomplete: reported on the info line, never silently dropped.
      let errors: string[] = [];
      let info: string[] = [];
      checkCrossDocAnchors(sources, { migrationComplete: false, errors, info, docDir: dir });
      expect(errors).toEqual([]);
      expect(info).toHaveLength(1);
      expect(info[0]).toContain('[cross-doc-deferred]');
      expect(info[0]).toContain('not-written-yet.md §some-anchor');

      // Complete: the same reference is a hard error.
      errors = [];
      info = [];
      checkCrossDocAnchors(sources, { migrationComplete: true, errors, info, docDir: dir });
      expect(info).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('which does not exist');
    });
  });

  it('says nothing about a doc-level pointer that carries no anchor', () => {
    withFixtureDir((dir) => {
      const errors: string[] = [];
      const info: string[] = [];
      checkCrossDocAnchors(
        [
          {
            name: 'source-doc.md',
            text: 'The full statement lives in `docs/conventions/not-written-yet.md`.',
          },
        ],
        { migrationComplete: true, errors, info, docDir: dir }
      );
      expect(errors).toEqual([]);
      expect(info).toEqual([]);
    });
  });

  it('pairs an anchor with the doc beside it, in either order and across a line break', () => {
    expect(crossDocRefs('stated at `§a-rule` in\n`docs/conventions/other-doc.md`.')).toEqual([
      { anchor: 'a-rule', slug: 'other-doc' },
    ]);
    expect(crossDocRefs("`docs/conventions/other-doc.md`'s `§a-rule` says so.")).toEqual([
      { anchor: 'a-rule', slug: 'other-doc' },
    ]);
  });

  it('leaves a same-doc anchor unpaired, even one sentence after an unrelated doc is named', () => {
    // The real false pairing this guard exists for, caught on check 9's first
    // run: park-progression names schema-and-migrations.md, ends the sentence,
    // then cites its OWN §park-target-frozen some 60 characters later.
    expect(crossDocRefs('`§own-section` below carries it.')).toEqual([]);
    expect(
      crossDocRefs(
        'stated in full in `docs/conventions/schema-and-migrations.md`. The two frozen ' +
          'denominators it depends on are tabulated at `§own-section` above.'
      )
    ).toEqual([]);
  });
});

describe('CLAUDE.md core', () => {
  const md = readFileSync('CLAUDE.md', 'utf8');
  const core = md.split('## Topics')[0];

  it('opens with the eight tripwires', () => {
    for (const phrase of [
      '`.js` extension',
      'ctx.now()',
      'ctx.rng()',
      'better-sqlite3',
      'deploy-commands',
      'one bot process per token',
      'addChoices',
      'customId',
      'npm run typecheck',
    ]) {
      expect(core, `core is missing: ${phrase}`).toContain(phrase);
    }

    // The brief's version of this list greps the core for the bare string
    // `.js`, which is also a substring of `.json` and `.mjs` — both of which
    // appear in any honest topic index — so that assertion passes on prose
    // that never states the ESM rule at all. Bind the extension to the
    // imports it governs instead.
    expect(core, 'core must state the ESM relative-import rule').toMatch(
      /relative import[\s\S]{0,120}`\.js` extension/
    );
  });

  it('indexes every doc in the manifest', () => {
    // Scoped to the index itself rather than the whole file: while the
    // UNMIGRATED marker stands, everything below it is the un-split original,
    // where a slug could match prose instead of an index line naming it.
    const topics = md.split('## Topics')[1]?.split('<!-- UNMIGRATED')[0] ?? '';
    expect(topics, 'CLAUDE.md has no "## Topics" index').not.toBe('');
    for (const d of manifest.docs) {
      expect(topics, `index is missing ${d.slug}`).toContain(d.slug);
    }
  });
});
