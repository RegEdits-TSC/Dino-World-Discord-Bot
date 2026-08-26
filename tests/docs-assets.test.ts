import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svgCount = readdirSync(resolve(process.cwd(), 'assets/emojis/svg')).filter((f) => f.endsWith('.svg')).length;
// Base banners only: a `-vN` file is another face of an existing banner, not a new
// one, so it must not move the figure quoted in prompts.md. Counting files instead
// of banners would make the prose churn on every variant with nothing gained.
const bannerCount = readdirSync(resolve(process.cwd(), 'assets/images/banners'))
  .filter((f) => f.endsWith('.webp') && !/-v\d+\.webp$/.test(f)).length;
const ops = readFileSync(resolve(process.cwd(), 'docs/ops.md'), 'utf8');
const prompts = readFileSync(resolve(process.cwd(), 'docs/assets/prompts.md'), 'utf8');

describe('docs track the committed assets', () => {
  // The operator docs quoted "21 emojis" while 33 were committed, because nothing checked. The count
  // matters operationally: deploy-emojis is the only irreversible live write in the deploy, and the
  // runbook uses this number to tell the operator what a lost manifest.json would recreate.
  it('every emoji count quoted in the docs equals the number of committed SVGs', () => {
    const quoted = [...ops.matchAll(/(\d+)\s+(?:custom |application )?emojis/g), ...prompts.matchAll(/(\d+)\s+(?:custom |application )?emojis/g)]
      .map((m) => Number(m[1]));
    expect(quoted.length, 'no emoji count found in the docs — did the wording change?').toBeGreaterThan(0);
    for (const n of quoted) expect(n).toBe(svgCount);
  });

  // This branch had to hand-fix exactly this drift once already ("fifteen" -> "twenty-six"), the same
  // failure this whole file exists to catch after an emoji count drifted silently. A word-spelled
  // numeral ("twenty-six") can't be regexed, which is why the two banner-count mentions in prompts.md
  // were switched to digits alongside this test. The emoji regex above and this one target disjoint
  // words ("emojis" vs "banners"), so neither line can accidentally satisfy the other's check.
  it('every banner count quoted in prompts.md equals the number of committed banner files', () => {
    const quoted = [...prompts.matchAll(/(\d+)\s+(?:embed |wide )?banners/g)].map((m) => Number(m[1]));
    expect(quoted.length, 'no banner count found in prompts.md — did the wording change?').toBeGreaterThan(0);
    for (const n of quoted) expect(n).toBe(bannerCount);
  });

  // prompts.md writes a prompt once as a frame with {PLACEHOLDER} slots, then
  // substitutes them per file below. A frame whose placeholder is never substituted
  // reads as a complete prompt and is not one — the files it governs cannot be
  // regenerated from it at all.
  //
  // That is not hypothetical. {FRACTURE} shipped exactly that way: one occurrence, in
  // the frame, with no substitution list anywhere, leaving all 18 hatch-crack variants
  // unreproducible on a branch whose stated reason to exist is that the generator is
  // gone. Nothing was watching, because every other check in this file counts assets
  // rather than reading the prompts.
  //
  // A substituted placeholder necessarily appears at least twice: once in its frame,
  // once introducing the list that fills it. The two exemptions are the two halves of
  // the CRITICAL FRAMING block, whose substitutions are a TABLE COLUMN ("parts /
  // threatened edges") rather than a repeated token — so they are checked by asserting
  // that column still exists instead.
  it('every prompt placeholder in prompts.md is substituted somewhere', () => {
    const BY_TABLE_COLUMN = ['{PARTS}', '{THREATENED}'];
    const counts = new Map<string, number>();
    for (const m of prompts.matchAll(/\{[A-Z][A-Z_]+\}/g)) {
      counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
    }
    expect(counts.size, 'no placeholders found in prompts.md — did the convention change?')
      .toBeGreaterThan(0);
    const unsubstituted = [...counts]
      .filter(([token, n]) => n < 2 && !BY_TABLE_COLUMN.includes(token))
      .map(([token]) => token);
    expect(unsubstituted, `these appear only in a prompt frame, with nothing filling them: ${unsubstituted.join(', ')}`)
      .toEqual([]);
    for (const token of BY_TABLE_COLUMN) {
      expect(counts.has(token), `${token} is gone — drop it from BY_TABLE_COLUMN`).toBe(true);
    }
    expect(prompts, 'the CRITICAL FRAMING substitution column is what stands in for {PARTS}/{THREATENED}')
      .toContain('Framing (parts / threatened edges)');
  });

  // Registered from DISK, not hand-typed: a hand-typed list can only prove that what
  // it names has a prompt row, and would give a newly committed park raster (e.g. a
  // future landmark-d/e/f band) zero checking the moment it lands with no matching
  // prompts.md row — silently, since nothing else in this suite checks prompts.md
  // coverage for assets/images/park/. tests/park-art-assets.test.ts derives its
  // landmark-band list from disk for the same reason.
  it('prompts.md carries a regeneration target for every generated park raster', () => {
    const files = readdirSync(resolve(process.cwd(), 'assets/images/park'))
      .filter((f) => f.endsWith('.webp'))
      .map((f) => `park/${f}`);
    expect(files.length, 'no park art found — wrong root?').toBeGreaterThan(0);
    for (const f of files) {
      expect(prompts, `prompts.md is missing the regeneration target ${f}`).toContain(f);
    }
  });
});
