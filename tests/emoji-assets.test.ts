import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, Image } from '@napi-rs/canvas';
import { renderSvg } from '../src/core/render-svg.js';
import { EMOJI_FALLBACK } from '../src/core/emojis.js';
import { FOODS } from '../src/data/foods.js';
import { RARITY } from '../src/data/rarity.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';

const SVG_DIR = resolve(process.cwd(), 'assets/emojis/svg');
const PNG_DIR = resolve(process.cwd(), 'assets/emojis/png');
const SIZE = 128;

// Pure black makes up a negligible share of any legitimately rendered emoji: every outline in the
// approved set is a dark brown/green/blue/purple (e.g. #7a5a10, #5e1a12, #0f5560), never black. The
// resvg gradient-ellipse bug (see CLAUDE.md) instead fills a whole shape solid black, which dwarfs
// this threshold; incidental antialiasing between adjacent dark shapes stays well under it.
const MAX_BLACK_SHARE = 0.02;

// @napi-rs/canvas decodes raster (PNG) sources asynchronously under the hood even though `Image.src =`
// returns immediately with `complete: true` — drawImage right after assignment silently draws a blank
// canvas. SVG decode (used by renderSvg itself) genuinely is synchronous, so only this PNG-reading path
// needs the await. This is the only safe way to decode a buffer anywhere in this file before inspecting
// pixels: there is deliberately no synchronous alternative here, because a synchronous helper is exactly
// what let the corner-only assertions below pass vacuously before this file's pixel checks existed (see
// CLAUDE.md / task history) — width/height come back populated correctly either way, so only a decoded
// pixel read catches the gap.
async function decodePng(png: Buffer): Promise<Image> {
  const i = new Image();
  i.src = png;
  await i.decode();
  return i;
}

describe('renderSvg', () => {
  it('renders an SVG buffer whose decoded pixels prove SVG decode completed synchronously', async () => {
    // width/height are populated synchronously the instant `Image.src` is assigned, regardless of
    // whether decoding actually finished — so a dimensions-only assertion here would pass identically
    // even if renderSvg's un-awaited `img.decode()` call (see render-svg.ts) raced ahead of a blank
    // canvas. Sampling a specific, unambiguous pixel is what actually proves the render happened.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="#ff0000"/></svg>');
    const img = await decodePng(renderSvg(svg, 128));
    expect(img.width).toBe(128);
    expect(img.height).toBe(128);

    const canvas = createCanvas(128, 128);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    // Circle center (32,32) in the 64×64 viewBox maps to (64,64) at 2x scale — well inside the r=20
    // (scaled to 40px) fill, so this is unambiguously interior, not an antialiased edge pixel.
    expect(Array.from(c.getImageData(64, 64, 1, 1).data)).toEqual([255, 0, 0, 255]);
  });
});

describe('emoji assets', () => {
  const svgs = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg'));
  it('at least the currency trio exists', () => {
    expect(svgs).toEqual(expect.arrayContaining(['dw_cash.svg', 'dw_food.svg', 'dw_shard.svg']));
  });
  it.each(svgs)('%s has a 128×128 PNG sibling that actually rendered the artwork', async (f) => {
    const png = readFileSync(resolve(PNG_DIR, f.replace('.svg', '.png')));
    const img = await decodePng(png);
    expect(img.width).toBe(SIZE);
    expect(img.height).toBe(SIZE);
    const canvas = createCanvas(SIZE, SIZE);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);

    const corners: Array<[number, number]> = [[0, 0], [SIZE - 1, 0], [0, SIZE - 1], [SIZE - 1, SIZE - 1]];
    for (const [x, y] of corners) {
      expect(c.getImageData(x, y, 1, 1).data[3]).toBe(0);
    }

    // Central region must hold real art: an SVG that renders as an entirely empty transparent square
    // (e.g. a bad viewBox or a fill that resolves to nothing) would otherwise pass every corner check
    // above trivially, since a blank canvas is transparent everywhere including its corners.
    const centerData = c.getImageData(SIZE / 4, SIZE / 4, SIZE / 2, SIZE / 2).data;
    let centerOpaque = 0;
    for (let i = 3; i < centerData.length; i += 4) {
      if (centerData[i] === 255) centerOpaque++;
    }
    expect(centerOpaque).toBeGreaterThan(0);

    // Whole-image black share catches the resvg gradient-ellipse bug: a gradient that collapses to
    // solid black fills an entire shape, not just its outline, so it blows well past MAX_BLACK_SHARE.
    const fullData = c.getImageData(0, 0, SIZE, SIZE).data;
    let opaqueCount = 0;
    let blackCount = 0;
    for (let i = 0; i < fullData.length; i += 4) {
      if (fullData[i + 3] === 255) {
        opaqueCount++;
        if (fullData[i] === 0 && fullData[i + 1] === 0 && fullData[i + 2] === 0) blackCount++;
      }
    }
    expect(blackCount / opaqueCount).toBeLessThan(MAX_BLACK_SHARE);
  });
});

describe('svg set parity', () => {
  it('svg files exactly match the fallback-table names', () => {
    const names = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).map((f) => f.replace('.svg', '')).sort();
    expect(names).toEqual(Object.keys(EMOJI_FALLBACK).sort());
  });
});

describe('emoji name parity with data tables', () => {
  const svgNames = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).map((f) => f.replace('.svg', '')).sort();

  it('every FOODS emoji name has a committed SVG and a unicode fallback', () => {
    for (const f of Object.values(FOODS)) {
      expect(svgNames, `missing SVG for FOODS.${f.id}.emoji=${f.emoji}`).toContain(f.emoji);
      expect(Object.hasOwn(EMOJI_FALLBACK, f.emoji), `missing EMOJI_FALLBACK for ${f.emoji}`).toBe(true);
    }
  });
  it('every rarity has a dw_rarity_* SVG', () => {
    for (const r of Object.keys(RARITY)) {
      expect(svgNames, `missing SVG dw_rarity_${r}`).toContain(`dw_rarity_${r}`);
    }
  });
  // The park renderer draws these chips from their SVG source (loadParkArt), so a missing file is a
  // silently degraded park tile rather than a crash — this is the only thing that fails loudly.
  it('every rarity has a dw_dino_* SVG', () => {
    for (const r of Object.keys(RARITY)) {
      expect(svgNames, `missing SVG dw_dino_${r}`).toContain(`dw_dino_${r}`);
    }
  });
  it('every expedition site has a dw_site_* SVG', () => {
    for (const s of Object.keys(EXPEDITION_SITES)) {
      expect(svgNames, `missing SVG dw_site_${s}`).toContain(`dw_site_${s}`);
    }
  });
});
