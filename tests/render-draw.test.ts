import { describe, it, expect } from 'vitest';
import { createCanvas, Image } from '@napi-rs/canvas';
import { gridDims, renderParkPng, dinoStatText } from '../src/core/render/draw.js';
import type { ParkSnapshot } from '../src/modules/park/snapshot.js';
import { EMPTY_ART, type ParkArt } from '../src/core/render/art.js';

describe('gridDims', () => {
  it('rows scale with cell count at 3 columns; width is constant', () => {
    expect(gridDims(0).rows).toBe(1);
    expect(gridDims(3).rows).toBe(1);
    expect(gridDims(4).rows).toBe(2);
    expect(gridDims(9).rows).toBe(3);
    expect(gridDims(3).width).toBe(gridDims(9).width);
  });
});

// dinoStatText is the value string iconValue draws for the dino-count stat, entirely in the SANS
// font. SANS has no emoji coverage, so any codepoint outside its Latin range renders as a
// missing-glyph "tofu" box — which is exactly what happened when this string used to embed a 🚨
// (U+1F6A8) emoji for the escaped count. Testing the exact wording alone ("does it say '2 escaped'")
// would be weak here, because the original bug's wording was arguably fine — '2🚨' also communicated
// "2 escaped" — it was *which font drew it* that broke. So this test asserts the causal invariant
// instead: every codepoint in the composed string must stay inside SANS's coverage, which is what
// actually prevents tofu, regardless of exact phrasing. (0x250 is a generous cutoff — comfortably
// above all of Latin Extended-A/B and comfortably below the emoji blocks, which start at 0x1F000+.)
//
// A pixel-level "no tofu visible" assertion was considered and rejected: unlike the coin SVG's own
// defined stroke color (a value we author and control), the tofu glyph's shape/color is an
// undocumented fallback rendered by the font/engine's .notdef path — asserting on its exact pixels
// would be brittle to font or @napi-rs/canvas upgrades unrelated to this bug, and a shape we have no
// stable source-of-truth for. The character-range check below fails deterministically and for the
// right reason if an emoji is ever reintroduced into this specific SANS-drawn string.
describe('dinoStatText', () => {
  it('keeps the escaped count visible as plain text, not dropped', () => {
    expect(dinoStatText(14, 0)).toBe('14');
    expect(dinoStatText(14, 2)).toBe('14 (2 escaped)');
  });

  it('never emits a codepoint outside SANS Latin coverage (guards against a re-introduced emoji causing tofu)', () => {
    for (const [dinoCount, escapedCount] of [[0, 0], [14, 2], [3, 3], [100, 1]] as const) {
      const text = dinoStatText(dinoCount, escapedCount);
      for (const ch of text) {
        expect(ch.codePointAt(0)!).toBeLessThan(0x250);
      }
    }
  });
});

const sample: ParkSnapshot = {
  parkName: 'Jurassic Cove', cash: 12400, parkRating: 420, dinoCount: 3, escapedCount: 1, lotCap: 5,
  lots: [
    { id: 1, type: 'paddock', kind: 'carnivore_paddock', name: 'T-Rex Pen', level: 3, decorCount: 2,
      dinos: [
        { speciesId: 'tyrannosaurus', rarity: 'legendary', escaped: false },
        { speciesId: 'tyrannosaurus', rarity: 'legendary', escaped: true },
      ] },
    { id: 2, type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab With A Very Long Name', level: 2, decorCount: 0, dinos: [] },
  ],
};

describe('renderParkPng', () => {
  it('returns a non-empty PNG buffer (magic bytes)', () => {
    const png = renderParkPng(sample);
    expect(png.length).toBeGreaterThan(1000);
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it('renders an empty park without throwing', () => {
    const png = renderParkPng({ ...sample, lots: [], dinoCount: 0, escapedCount: 0 });
    expect(png.length).toBeGreaterThan(100);
  });

  // Guards against the silent failure the HUD icon load is exposed to: if the SVG fails to decode,
  // drawImage becomes a no-op and the coin slot renders as a blank gap while every assertion above
  // (buffer returned, correct dimensions) still passes. This scans the icon's own bounding box for
  // a pixel matching the coin SVG's own border-stroke color.
  //
  // A loose "any golden pixel" threshold (e.g. r>=150, g>=110, b<=110) was tried first and rejected:
  // measured against this exact box, the 💰 fallback glyph itself is golden-brown enough to satisfy
  // it (272 matching pixels vs. 190 for the real coin) — so that check could not tell "coin drawn"
  // from "glyph fallback drawn" and would never fail when the guard it's meant to protect breaks.
  // The coin SVG's border stroke is `#7a5a10` (122,90,16) exactly (assets/emojis/svg/dw_cash.svg);
  // sampled pixel-for-pixel, that exact color (allowing antialiasing tolerance) occurs 60 times in
  // this box when the real coin is drawn and 0 times when the glyph fallback runs instead — a color
  // no legitimate fallback rendering produces here, so its presence is a reliable positive signal.
  it('draws the coin artwork (not a blank gap) in the HUD cash slot', async () => {
    const png = renderParkPng(sample);

    // renderParkPng decodes the icon from an SVG buffer, which @napi-rs/canvas decodes synchronously
    // (see draw.ts / render-svg.ts). The PNG buffer we decode *here*, to inspect pixels, is raster and
    // must be awaited — an unawaited `img.decode()` on a PNG silently yields a blank canvas.
    const img = new Image();
    img.src = png;
    await img.decode();
    const canvas = createCanvas(img.width, img.height);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);

    // Derive the icon's bounding box from the HUD block's own coordinates in draw.ts, rather than
    // hardcoding magic numbers: sx starts at dims.width * 0.46, the rating (star) stat is drawn
    // first via iconValue(..., '⭐', ratingText, 22) + 18, then the cash icon is drawn by
    // iconImageValue at (sx, y - size + 3, size, size) with y = 40, size = 22. Font metrics are
    // measured with the same font strings draw.ts uses; the fonts are already globally registered
    // by the renderParkPng call above.
    const hasBuild = sample.lots.length < sample.lotCap;
    const cellCount = sample.lots.length + (hasBuild ? 1 : 0);
    const dims = gridDims(cellCount);
    const meas = createCanvas(1, 1).getContext('2d');
    meas.font = '22px "Noto Color Emoji"';
    const starWidth = meas.measureText('⭐').width;
    meas.font = '22px "Noto Sans"';
    const ratingText = (sample.parkRating / 100).toFixed(1);
    const ratingWidth = meas.measureText(ratingText).width;
    const iconX = dims.width * 0.46 + starWidth + 6 + ratingWidth + 18;
    const iconY = 40 - 22 + 3;
    const size = 22;

    let sawCoinBorder = false;
    for (let y = Math.floor(iconY); y < Math.ceil(iconY + size) && !sawCoinBorder; y++) {
      for (let x = Math.floor(iconX); x < Math.ceil(iconX + size) && !sawCoinBorder; x++) {
        const [r, g, b] = c.getImageData(x, y, 1, 1).data;
        if (Math.abs(r - 122) < 15 && Math.abs(g - 90) < 15 && Math.abs(b - 16) < 15) sawCoinBorder = true;
      }
    }
    expect(sawCoinBorder).toBe(true);
  });

  // Stub art is built from tiny SVG buffers, not PNGs: SVG decodes synchronously in @napi-rs/canvas,
  // so a stub can feed the synchronous renderer with no await, while a PNG stub would draw blank and
  // this test would "pass" for the wrong reason. Each slot gets a pure unmistakable hue so a sampled
  // pixel names exactly which art slot drew it — the same reasoning as the coin test above: a loose
  // color threshold cannot distinguish drawn art from the emoji glyph it is supposed to have replaced.
  function svgStub(color: string, w: number, h: number): Image {
    const img = new Image();
    img.src = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="${color}"/></svg>`,
    );
    return img;
  }

  const stubArt: ParkArt = {
    ground: svgStub('#0000ff', 120, 80),
    platePaddock: svgStub('#ff00ff', 270, 150),
    plateFacility: svgStub('#ff8800', 270, 150),
    lotIcons: { carnivore_paddock: svgStub('#00ffff', 64, 64), hatchery_lab: svgStub('#00ffff', 64, 64) },
    dinoChips: { common: null, uncommon: null, rare: null, epic: null, legendary: svgStub('#ffff00', 64, 64), mythic: null },
  };

  async function sampler(png: Buffer): Promise<(x: number, y: number) => number[]> {
    const img = new Image();
    img.src = png;
    await img.decode();          // PNG decode is async — skipping this yields a blank canvas
    const canvas = createCanvas(img.width, img.height);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    return (x, y) => Array.from(c.getImageData(x, y, 1, 1).data).slice(0, 3);
  }

  // The fallback pin. Asserted in-process rather than against a committed golden hash: the output is
  // byte-deterministic within and across processes, but a hash would break on any @napi-rs/canvas or
  // Noto font bump that has nothing to do with this change.
  it('an all-null ParkArt renders byte-for-byte what the no-art call renders', () => {
    expect(renderParkPng(sample, EMPTY_ART).equals(renderParkPng(sample))).toBe(true);
  });

  it('draws ground, both plates, the lot icon and the dino chip in place of the flat fills and glyphs', async () => {
    // Coordinates derive from draw.ts's own constants: tile 0 sits at (PAD, HEADER_H + PAD) = (20, 84),
    // TILE_W/TILE_H = 270×150, GAP = 16 so tile 1 starts at x = 306. The lot icon box is
    // (x+14, y+42-30+3) 30², and the first dino chip box is (x+16, y+100-28+3) 28².
    const at = await sampler(renderParkPng(sample, stubArt));
    expect(at(10, 240)).toEqual([0, 0, 255]);      // ground, in the left margin below the header
    expect(at(10, 10)).toEqual([35, 74, 30]);      // header bar (#234a1e) still painted over the ground
    expect(at(260, 210)).toEqual([255, 0, 255]);   // paddock plate, clear of icon, text, dinos and decor
    expect(at(546, 210)).toEqual([255, 136, 0]);   // facility plate on tile 1
    expect(at(49, 114)).toEqual([0, 255, 255]);    // lot icon replaced the 🦖 glyph run
    expect(at(50, 173)).toEqual([255, 255, 0]);    // legendary dino chip replaced the 🦖 glyph run
  });
});
