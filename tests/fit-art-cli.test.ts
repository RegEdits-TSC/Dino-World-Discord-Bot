import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Image, createCanvas } from '@napi-rs/canvas';

// scripts/fit-art.mjs cannot be imported: it is a top-level-await script with no
// exports (its own header says so), so tests/art-pipeline.test.ts can only reach the
// pure helpers it delegates to. Everything the CLI itself decides — which mode maps to
// which geometry, which flag is legal on which mode, which failures exit nonzero — was
// therefore untested, on the producer that made 244 committed files that cannot be
// regenerated. Spawning it is the only way to cover that, following the precedent in
// tests/make-gif.test.ts.
//
// The gap this closes concretely: `mode === 'portrait' ? FIT_24 : FIT_31` at
// fit-art.mjs. tests/art-pipeline.test.ts pins the two CONSTANTS and the fitDraw
// arithmetic, but nothing pinned the branch-to-mode WIRING — swapping the two arms
// leaves the whole suite green while every future egg, boss portrait, crack and dino
// portrait ships at the other family's margin.
//
// NEVER writes under assets/images/. vitest runs test files in parallel forks, so a
// write there can be observed, or deleted, by another file mid-run. Sources are read
// from the committed set; destinations are all inside a temp dir.
const CLI = resolve(process.cwd(), 'scripts/fit-art.mjs');
let dir: string;

function run(...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

async function measure(path: string): Promise<{ w: number; h: number; margin: number; opaque: boolean }> {
  const img = new Image();
  img.src = readFileSync(path);
  await img.decode();
  const canvas = createCanvas(img.width, img.height);
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0);
  const px = c.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1, clear = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (px[(y * img.width + x) * 4 + 3] === 0) { clear++; continue; }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return {
    w: img.width,
    h: img.height,
    margin: Math.min(x0, y0, img.width - 1 - x1, img.height - 1 - y1),
    opaque: clear === 0,
  };
}

describe('fit-art.mjs CLI', () => {
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'dw-fit-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('mode dispatch', () => {
    // Each cover mode's output size comes from COVER[mode], which art-pipeline.test.ts
    // pins as data. This proves the CLI actually LOOKS THERE for the mode it was given,
    // rather than any of them resolving to the same constant.
    it.each([
      ['banner', 1536, 1024],
      ['ground', 1200, 800],
      ['band', 270, 150],
      ['square', 1024, 1024],
    ])('%s writes %ix%i', async (mode, w, h) => {
      const dest = join(dir, `${mode}.webp`);
      const r = run(mode as string, resolve(process.cwd(), 'assets/images/banners/care.webp'), dest);
      expect(r.status, r.stderr).toBe(0);
      const m = await measure(dest);
      expect([m.w, m.h]).toEqual([w, h]);
      // Cover modes are opaque: no background removal, no defringe, no margin.
      // `square` shares only its output size with `cutout`, which is exactly the
      // confusion the mode table in docs/assets/prompts.md now warns about.
      expect(m.opaque, `${mode} should be fully opaque`).toBe(true);
    });

    it('rejects an unknown mode with the usage banner', () => {
      const r = run('thumbnail', resolve(process.cwd(), 'assets/images/banners/care.webp'), join(dir, 'x.webp'));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('usage:');
      expect(existsSync(join(dir, 'x.webp'))).toBe(false);
    });

    it('rejects a missing destination argument', () => {
      const r = run('banner', resolve(process.cwd(), 'assets/images/banners/care.webp'));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('usage:');
    });
  });

  // THE POINT OF THIS FILE. cutout fits at 31px and portrait at 24px, and the only
  // thing choosing between them is one ternary in a file no test could reach. Both
  // margins are asserted here against real output, so swapping the ternary's arms
  // fails — where before it passed the entire suite, and the 24-vs-31 disagreement
  // only surfaced once a file landed under assets/images/ and a disk-registered
  // margin case opened it.
  describe('cutout and portrait are not interchangeable', () => {
    it('cutout fits a transparent subject at 31px, keeping every region', async () => {
      const dest = join(dir, 'cutout.webp');
      const r = run('cutout', resolve(process.cwd(), 'assets/images/hatch/rare-crack.webp'), dest);
      expect(r.status, r.stderr).toBe(0);
      const m = await measure(dest);
      expect([m.w, m.h]).toEqual([1024, 1024]);
      expect(Math.abs(m.margin - 31), `margin ${m.margin}, expected ~31`).toBeLessThanOrEqual(1);
    });

    it('portrait fits at 24px', async () => {
      const dest = join(dir, 'portrait.webp');
      const r = run('portrait', resolve(process.cwd(), 'assets/images/battles/boss-coastal_dig-portrait.webp'), dest);
      expect(r.status, r.stderr).toBe(0);
      const m = await measure(dest);
      expect([m.w, m.h]).toEqual([1024, 1024]);
      expect(Math.abs(m.margin - 24), `margin ${m.margin}, expected ~24`).toBeLessThanOrEqual(1);
    });
  });

  describe('--axis=egg', () => {
    // The egg-axis fit centres on the egg rather than the whole nest bbox, so L and R
    // diverge while T and B stay at 24 — the signature docs/assets/prompts.md's margin
    // table records, and the reason a symmetric 31/31 reading means `cutout` was used
    // by mistake.
    it('re-centres horizontally on portrait, leaving the vertical margin at 24', async () => {
      const dest = join(dir, 'egg.webp');
      const r = run('portrait', '--axis=egg', resolve(process.cwd(), 'assets/images/eggs/common.webp'), dest);
      expect(r.status, r.stderr).toBe(0);
      const m = await measure(dest);
      expect([m.w, m.h]).toEqual([1024, 1024]);
      const img = new Image();
      img.src = readFileSync(dest);
      await img.decode();
      const canvas = createCanvas(1024, 1024);
      const c = canvas.getContext('2d');
      c.drawImage(img, 0, 0);
      const px = c.getImageData(0, 0, 1024, 1024).data;
      let x0 = 1024, x1 = -1, y0 = 1024, y1 = -1;
      for (let y = 0; y < 1024; y++) {
        for (let x = 0; x < 1024; x++) {
          if (px[(y * 1024 + x) * 4 + 3] === 0) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      expect(Math.abs(Math.min(y0, 1023 - y1) - 24)).toBeLessThanOrEqual(1);
      expect(x0, 'the egg-axis fit is asymmetric horizontally by design').not.toBe(1023 - x1);
    });

    it('rejects a misspelled flag', () => {
      const r = run('portrait', '--axis=eggs', resolve(process.cwd(), 'assets/images/eggs/common.webp'), join(dir, 'x.webp'));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('unknown flag --axis=eggs');
    });

    // A correctly spelled flag on a mode that ignores it is the same silent failure as
    // a misspelled one: the run exits 0 with a whole-bbox-centred subject instead of an
    // egg-axis one, and no output says so. The KNOWN_FLAGS loop states that reasoning
    // and did not cover this case.
    it.each(['cutout', 'banner', 'square'])('rejects --axis=egg on %s', (mode) => {
      const dest = join(dir, `axis-${mode}.webp`);
      const r = run(mode, '--axis=egg', resolve(process.cwd(), 'assets/images/eggs/common.webp'), dest);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`--axis=egg applies to portrait only, not ${mode}`);
      expect(existsSync(dest)).toBe(false);
    });
  });

  describe('failure paths', () => {
    it('exits 1 on a fully transparent source rather than writing an empty file', () => {
      const src = join(dir, 'blank.png');
      const c = createCanvas(600, 600);
      writeFileSync(src, c.toBuffer('image/png'));
      const dest = join(dir, 'blank.webp');
      const r = run('cutout', src, dest);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('fully transparent');
      expect(existsSync(dest)).toBe(false);
    });

    // --axis=egg's stated purpose is to shift the egg WITHOUT cropping the nest, so a
    // fitBox much narrower than the whole opaque box drives the whole box's drawn rect
    // off the canvas. fit-art.mjs's own comment records the synthetic case; this is it.
    it('exits 1 when the egg-axis fit would push the subject off the canvas', () => {
      const src = join(dir, 'wide-nest.png');
      const c = createCanvas(900, 800);
      const ctx = c.getContext('2d');
      // One connected silhouette (portrait keeps only the largest region, so a
      // free-floating egg would simply be deleted instead). Saturated fills, so the
      // luminance peel cannot erode them. The egg occupies the top 45% the egg-axis
      // fit measures; the nest is nearly three times wider.
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(300, 40, 300, 320);          // narrow "egg", top 45%
      ctx.fillRect(440, 340, 20, 280);          // stem joining the two
      ctx.fillStyle = '#8e44ad';
      ctx.fillRect(20, 600, 860, 120);          // very wide "nest" along the bottom
      writeFileSync(src, c.toBuffer('image/png'));
      const r = run('portrait', '--axis=egg', src, join(dir, 'wide-nest.webp'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('subject does not fit');
    });
  });
});
