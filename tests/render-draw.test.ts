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
    groundBySeason: { wet: null, dry: null, cold: null },
    platePaddock: svgStub('#ff00ff', 270, 150),
    plateFacility: svgStub('#ff8800', 270, 150),
    lotIcons: { carnivore_paddock: svgStub('#00ffff', 64, 64), hatchery_lab: svgStub('#00ffff', 64, 64) },
    dinoChips: { common: null, uncommon: null, rare: null, epic: null, legendary: svgStub('#ffff00', 64, 64), mythic: null },
    landmarks: { a: null, b: null, c: null },
    attractions: {},
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

  // Proves the season id travels snapshot -> draw.ts -> pixel, entirely through ParkArt.groundBySeason
  // (never Date.now() inside the renderer — see the byte-identical pin above, which this must not
  // break). Each season gets its own unmistakable hue, distinct from every color stubArt already uses,
  // so a sampled pixel names exactly which season's raster drew it.
  const seasonalArt: ParkArt = {
    ...stubArt,
    groundBySeason: {
      wet: svgStub('#22cc55', 120, 80),
      dry: svgStub('#ddaa11', 120, 80),
      cold: svgStub('#3388ee', 120, 80),
    },
  };

  it('draws the season\'s own ground raster when snapshot.season names one', async () => {
    const wet = await sampler(renderParkPng({ ...sample, season: 'wet' }, seasonalArt));
    const dry = await sampler(renderParkPng({ ...sample, season: 'dry' }, seasonalArt));
    const cold = await sampler(renderParkPng({ ...sample, season: 'cold' }, seasonalArt));
    expect(wet(10, 240)).toEqual([0x22, 0xcc, 0x55]);
    expect(dry(10, 240)).toEqual([0xdd, 0xaa, 0x11]);
    expect(cold(10, 240)).toEqual([0x33, 0x88, 0xee]);
  });

  it('falls back to the base ground when the snapshot names no season, even though seasonal art is loaded', async () => {
    const noSeason = await sampler(renderParkPng(sample, seasonalArt));
    expect(noSeason(10, 240)).toEqual([0, 0, 255]);   // stubArt.ground, not any seasonal color above
  });

  // The landmark is drawn as one extra grid cell AFTER the build slot, so every existing tile keeps
  // its coordinates — that placement is why none of the seven pinned pixel samples above move.
  describe('landmark cell', () => {
    // A test that rendered `sample` twice with the same art and compared the buffers used to
    // sit here, called "a snapshot with no landmark renders byte-identically to today". It was
    // DELETED rather than strengthened: two identical calls test determinism, which the
    // all-null-ParkArt pin above already covers, and it could not fail for its stated reason —
    // if drawLandmark ran unconditionally at tier 0, both renders would change identically and
    // it would still pass. Its `expect(sample.landmarkTier).toBeUndefined()` line asserted a
    // property of the fixture two screens up, not of the renderer. The real gate for "tier 0
    // draws no cell" is the decoded gridDims(3).height pin in the next test, which is where a
    // fourth cell at tier 0 shows up as a second row.
    it('a landmark adds exactly one cell, growing the grid', async () => {
      // sample has 2 lots and lotCap 5, so hasBuild is true: 3 cells, 1 row, 254 tall.
      // A landmark makes 4 cells, 2 rows, 420 tall. Decode both PNGs and check the actual
      // rendered dimensions, not just the pure gridDims arithmetic — that ties the assertion
      // to renderParkPng's own cellCount computation instead of a formula that can't fail.
      const plainPng = renderParkPng(sample, EMPTY_ART);
      const markedPng = renderParkPng({ ...sample, landmarkTier: 1 }, EMPTY_ART);
      expect(markedPng.equals(plainPng)).toBe(false);

      const plainImg = new Image(); plainImg.src = plainPng; await plainImg.decode();
      const markedImg = new Image(); markedImg.src = markedPng; await markedImg.decode();
      expect(plainImg.height).toBe(gridDims(3).height);
      expect(markedImg.height).toBe(gridDims(4).height);
    });

    it('draws the monument art when the band loaded, and the flat fill when it did not', async () => {
      // Tile index 3 (lots.length=2 + hasBuild 1) -> col 0, row 1 -> x = PAD = 20,
      // y = HEADER_H + PAD + (TILE_H + GAP) = 64 + 20 + 166 = 250. Sample a point inside it,
      // clear of the drawn label near the tile's bottom edge.
      const markedArt: ParkArt = { ...EMPTY_ART, landmarks: { a: svgStub('#00ffff', 270, 150), b: null, c: null } };
      const at = await sampler(renderParkPng({ ...sample, landmarkTier: 1 }, markedArt));
      expect(at(120, 320)).toEqual([0, 255, 255]);
      const plainAt = await sampler(renderParkPng({ ...sample, landmarkTier: 1 }, EMPTY_ART));
      expect(plainAt(120, 320)).not.toEqual([0, 255, 255]);
    });

    it('renders a tier whose art is missing without throwing', () => {
      expect(() => renderParkPng({ ...sample, landmarkTier: 6 }, EMPTY_ART)).not.toThrow();
    });

    it('the existing ground sample is untouched by a landmark', async () => {
      const at = await sampler(renderParkPng({ ...sample, landmarkTier: 3 }, stubArt));
      expect(at(10, 240)).toEqual([0, 0, 255]);
    });
  });

  // Attraction cells append AFTER the landmark cell, count driven by data — same placement
  // rule the landmark cell itself follows relative to the build slot, and for the same
  // reason: every earlier tile must keep the exact coordinates it already had.
  describe('attraction cells', () => {
    // The brief's own version of this test only compares renderParkPng(sample) against
    // renderParkPng({ ...sample, attractions: [] }) to each other. That alone is weaker than
    // it looks: a broken implementation that always draws one unconditional attraction cell
    // (the exact bug constraint 2 exists to prevent) would still make `a` and `b` agree with
    // EACH OTHER, since both calls take the same broken path — so the pair could pass while
    // the feature is wrong. Pinning the decoded height against the independent gridDims(3)
    // formula (sample has 2 lots + lotCap 5, so hasBuild is true and 0 attractions must add
    // no row) is what actually proves no unconditional cell exists.
    it('renders byte-identically whether attractions is absent or an empty array, matching the pre-attraction grid', async () => {
      const a = renderParkPng(sample);
      const b = renderParkPng({ ...sample, attractions: [] });
      expect(Buffer.compare(a, b)).toBe(0);

      const img = new Image(); img.src = a; await img.decode();
      expect(img.height).toBe(gridDims(3).height);
    });

    // The other half of the same concern: "byte-identical at zero" must not be true merely
    // because the feature does nothing. A built attraction has to actually change the output.
    it('a park with an attraction renders differently from one without', () => {
      const bare = renderParkPng(sample);
      const withOne = renderParkPng({ ...sample, attractions: [{ kind: 'gift_shop', level: 2 }] });
      expect(Buffer.compare(bare, withOne)).not.toBe(0);
    });

    it('adds one cell per attraction, after the landmark cell, without moving any earlier tile', async () => {
      const withOne = renderParkPng({ ...sample, attractions: [{ kind: 'gift_shop', level: 2 }] }, stubArt);
      const bare = renderParkPng(sample, stubArt);
      expect(withOne.length).not.toBe(bare.length);

      // Re-run the six pinned pixel samples from "draws ground, both plates, the lot icon
      // and the dino chip..." above against withOne: an appended cell must not move any of
      // them.
      const at = await sampler(withOne);
      expect(at(10, 240)).toEqual([0, 0, 255]);
      expect(at(10, 10)).toEqual([35, 74, 30]);
      expect(at(260, 210)).toEqual([255, 0, 255]);
      expect(at(546, 210)).toEqual([255, 136, 0]);
      expect(at(49, 114)).toEqual([0, 255, 255]);
      expect(at(50, 173)).toEqual([255, 255, 0]);

      const bareImg = new Image(); bareImg.src = bare; await bareImg.decode();
      const oneImg = new Image(); oneImg.src = withOne; await oneImg.decode();
      expect(bareImg.height).toBe(gridDims(3).height);
      expect(oneImg.height).toBe(gridDims(4).height);
    });

    it('draws one cell per attraction, count driven by data rather than hardcoded to one', async () => {
      const two = renderParkPng({
        ...sample,
        attractions: [{ kind: 'gift_shop', level: 1 }, { kind: 'sky_gondola', level: 3 }],
      });
      const img = new Image(); img.src = two; await img.decode();
      // 2 lots + build(1) + 0 landmark + 2 attractions = 5 cells -> 2 rows.
      expect(img.height).toBe(gridDims(5).height);
    });

    it('places attraction cells after the landmark cell when both are present, leaving the landmark cell undisturbed', async () => {
      const markedArt: ParkArt = { ...EMPTY_ART, landmarks: { a: svgStub('#00ffff', 270, 150), b: null, c: null } };
      const png = renderParkPng(
        { ...sample, landmarkTier: 1, attractions: [{ kind: 'gift_shop', level: 2 }] },
        markedArt,
      );
      // Landmark cell is still at its own slot (lots.length + hasBuild = index 3), matching
      // the existing landmark pin above — appending the attraction cell after it must not
      // move it.
      const at = await sampler(png);
      expect(at(120, 320)).toEqual([0, 255, 255]);

      // 2 lots + build(1) + landmark(1) + 1 attraction = 5 cells -> 2 rows.
      const img = new Image(); img.src = png; await img.decode();
      expect(img.height).toBe(gridDims(5).height);
    });

    it('renders an attraction of an unknown or retired kind without throwing', () => {
      expect(() => renderParkPng({ ...sample, attractions: [{ kind: 'retired_kind', level: 1 }] })).not.toThrow();
    });

    // The reason the draw site must guard `if (img)` and never `if (img !== null)`. ParkArt.attractions
    // is an OPEN Record<string, Image | null>, and tsconfig sets strict but not
    // noUncheckedIndexedAccess — so indexing it with a retired slug TYPES as Image | null while
    // RETURNING undefined, and drawImage(undefined) throws the identical TypeError drawImage(null)
    // does. That throw is not a degrade: it becomes { ok: false } from handleRenderRequest, rejects in
    // client.ts and costs the user the whole park image. Neither `npm run build` nor `npm test` can
    // see the wrong guard on its own.
    //
    // The record must be POPULATED for this to bite. The retired-slug test above renders with the
    // default EMPTY_ART, whose attractions is {}, so an implementation could in principle be wrong
    // only for a partially-populated record and still pass it.
    it('renders a retired kind without throwing even when other attraction art is loaded', () => {
      const artWithSome: ParkArt = {
        ...EMPTY_ART,
        attractions: { gift_shop: svgStub('#00ffff', 270, 150) },
      };
      expect(() => renderParkPng(
        { ...sample, attractions: [{ kind: 'retired_kind', level: 1 }] },
        artWithSome,
      )).not.toThrow();
    });

    // ParkArt gained an `attractions` family with no rasters committed yet, so every entry is null and
    // an attraction cell must still render exactly what it rendered before the field existed. Both
    // directions are pinned: an art object that CARRIES the record must agree with EMPTY_ART, and
    // EMPTY_ART must agree with the no-art call — the same fallback pin the top-level
    // "an all-null ParkArt renders byte-for-byte what the no-art call renders" test makes for a park
    // with no attractions at all, restated for a park that has some. Task 14 gives drawAttraction an
    // art path; this is what proves its null branch did not drift.
    it('an attractions record of all-null entries renders byte-identically to no art at all', () => {
      const snap: ParkSnapshot = {
        ...sample,
        attractions: [{ kind: 'gift_shop', level: 2 }, { kind: 'picnic_lawn', level: 1 }],
      };
      const nulledArt: ParkArt = { ...EMPTY_ART, attractions: { gift_shop: null, picnic_lawn: null } };
      expect(renderParkPng(snap, nulledArt).equals(renderParkPng(snap, EMPTY_ART))).toBe(true);
      expect(renderParkPng(snap, EMPTY_ART).equals(renderParkPng(snap))).toBe(true);
    });
  });
});
