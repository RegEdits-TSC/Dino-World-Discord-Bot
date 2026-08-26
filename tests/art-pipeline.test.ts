import { describe, it, expect } from 'vitest';
import {
  coverGeometry, alphaThreshold, luminancePeel, opaqueBBox, COVER, Q, stripCaBX,
  largestRegion, borderFlood, shave, eggAxisBBox, fitDraw, FIT_31, FIT_24,
} from '../scripts/lib/art-pipeline.mjs';

// A w×h RGBA buffer, fully transparent, with a helper to paint one pixel.
function buf(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4);
}
function set(px: Uint8ClampedArray, w: number, x: number, y: number,
             r: number, g: number, b: number, a: number): void {
  const i = (y * w + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

describe('constants', () => {
  it('keeps the committed encode quality and cover sizes', () => {
    expect(Q).toBe(95);
    expect(COVER.banner).toEqual([1536, 1024]);
    expect(COVER.ground).toEqual([1200, 800]);
    expect(COVER.band).toEqual([270, 150]);
    expect(COVER.square).toEqual([1024, 1024]);
  });
});

describe('coverGeometry', () => {
  // Cover, not contain: the scaled image must cover BOTH axes, so the scale is
  // the max of the two ratios and the overflow is split evenly as a centre crop.
  it('scales to cover and centres the overflow', () => {
    const g = coverGeometry(1264, 848, 1536, 1024);
    expect(g.w).toBe(1536);
    expect(g.h).toBe(1030);
    expect(g.dx).toBe(0);
    expect(g.dy).toBe(-3);
  });

  it('crops horizontally when the source is wider than the target aspect', () => {
    const g = coverGeometry(1600, 800, 270, 150);
    expect(g.h).toBe(150);
    expect(g.w).toBe(300);
    expect(g.dy).toBe(0);
  });

  // COVER.square reproduces the documented hand-pass recipe for site thumbs: a 3:2
  // source cover-scaled to 1:1 is a centred square crop resized — scale on the taller
  // axis, keep the full height, and split the horizontal overflow evenly.
  it('crops a 3:2 source to a centred square for the square mode', () => {
    const g = coverGeometry(1536, 1024, 1024, 1024);
    expect(g.h).toBe(1024);
    expect(g.w).toBe(1536);
    expect(g.dy).toBe(0);
    expect(g.dx).toBe(-256);
  });
});

describe('alphaThreshold', () => {
  it('zeroes alpha below the cutoff and leaves the rest untouched', () => {
    const px = buf(2, 1);
    set(px, 2, 0, 0, 10, 20, 30, 31);
    set(px, 2, 1, 0, 10, 20, 30, 32);
    alphaThreshold(px);
    expect(px[3]).toBe(0);
    expect(px[7]).toBe(32);
  });
});

describe('luminancePeel', () => {
  // The studio backdrop is light grey, so the matte leaves a light, desaturated
  // rim where the art's dark outline should be. Peel removes boundary pixels
  // that are both bright (lum > 180) and desaturated (chroma < 40).
  it('peels a bright desaturated edge pixel but spares a saturated one', () => {
    const px = buf(3, 1);
    set(px, 3, 0, 0, 240, 240, 240, 255);  // bright, desaturated -> peeled
    set(px, 3, 1, 0, 10, 10, 10, 255);     // dark core -> kept
    set(px, 3, 2, 0, 240, 20, 20, 255);    // bright but saturated -> kept
    luminancePeel(px, 3, 1);
    expect(px[3]).toBe(0);
    expect(px[7]).toBe(255);
    expect(px[11]).toBe(255);
  });
});

describe('opaqueBBox', () => {
  it('returns the tight box around every opaque pixel', () => {
    const px = buf(5, 5);
    set(px, 5, 1, 2, 0, 0, 0, 255);
    set(px, 5, 3, 4, 0, 0, 0, 255);
    expect(opaqueBBox(px, 5, 5)).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
  });

  it('returns null for a fully transparent image', () => {
    expect(opaqueBBox(buf(4, 4), 4, 4)).toBeNull();
  });
});

// PNG = 8-byte signature, then [4B length][4B type][data][4B CRC] chunks.
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  // CRC value is never validated by the strip, which only walks lengths and types.
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('stripCaBX', () => {
  it('removes only the caBX chunk and leaves the others byte-identical', () => {
    const ihdr = chunk('IHDR', Buffer.alloc(13, 7));
    const cabx = chunk('caBX', Buffer.from('<svg xmlns="..."/>', 'latin1'));
    const idat = chunk('IDAT', Buffer.from('pixels', 'latin1'));
    const out = stripCaBX(Buffer.concat([SIG, ihdr, cabx, idat]));
    expect(out.equals(Buffer.concat([SIG, ihdr, idat]))).toBe(true);
  });

  it('returns a PNG with no caBX chunk unchanged', () => {
    const png = Buffer.concat([SIG, chunk('IHDR', Buffer.alloc(13, 7)),
                               chunk('IDAT', Buffer.from('pixels', 'latin1'))]);
    expect(stripCaBX(png).equals(png)).toBe(true);
  });

  it('removes every caBX chunk when a file carries more than one', () => {
    const ihdr = chunk('IHDR', Buffer.alloc(13, 7));
    const idat = chunk('IDAT', Buffer.from('pixels', 'latin1'));
    const out = stripCaBX(Buffer.concat([
      SIG, ihdr, chunk('caBX', Buffer.from('a')), idat, chunk('caBX', Buffer.from('b')),
    ]));
    expect(out.equals(Buffer.concat([SIG, ihdr, idat]))).toBe(true);
  });

  // A WebP or JPEG source has no PNG signature; the walk must not mangle it.
  it('returns a non-PNG buffer untouched', () => {
    const webp = Buffer.from('RIFF....WEBPVP8 ', 'latin1');
    expect(stripCaBX(webp).equals(webp)).toBe(true);
  });

  // A malformed length must not send the walk past the end of the buffer.
  it('stops cleanly on a truncated chunk rather than overrunning', () => {
    const bad = Buffer.concat([SIG, Buffer.from([0xff, 0xff, 0xff, 0xff]),
                               Buffer.from('IDAT', 'latin1')]);
    expect(() => stripCaBX(bad)).not.toThrow();
  });
});

describe('fit constants', () => {
  // 0.94 of 1024 = 962px on the tight axis -> a 31px margin (hatch, dinos).
  // 0.953125 of 1024 = 976px -> a 24px margin (eggs, battles).
  it('encode the two committed margins', () => {
    expect(Math.round((1024 - 1024 * FIT_31) / 2)).toBe(31);
    expect(Math.round((1024 - 1024 * FIT_24) / 2)).toBe(24);
  });
});

describe('largestRegion', () => {
  it('keeps the biggest connected blob and clears the rest', () => {
    const px = buf(6, 1);
    // A 3-pixel run, a gap, then a 2-pixel run.
    for (const x of [0, 1, 2]) set(px, 6, x, 0, 9, 9, 9, 255);
    for (const x of [4, 5]) set(px, 6, x, 0, 9, 9, 9, 255);
    largestRegion(px, 6, 1);
    expect([...px].filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 0, 0, 0]);
  });

  // The two-region fixture above cannot distinguish "keep the largest" from "keep
  // any region but the smallest" — a mutant that clears only the runner-up (the
  // second-largest, here the 2-pixel run) also passes it. A third, smallest region
  // pins that the survivor really is the LARGEST, not merely not-the-smallest.
  it('keeps the largest of three regions, not merely not-the-smallest', () => {
    const px = buf(8, 1);
    for (const x of [0, 1, 2]) set(px, 8, x, 0, 9, 9, 9, 255);  // largest: 3px
    set(px, 8, 4, 0, 9, 9, 9, 255);                             // smallest: 1px
    for (const x of [6, 7]) set(px, 8, x, 0, 9, 9, 9, 255);     // runner-up: 2px
    largestRegion(px, 8, 1);
    expect([...px].filter((_, i) => i % 4 === 3))
      .toEqual([255, 255, 255, 0, 0, 0, 0, 0]);
  });

  it('is a no-op on a single region', () => {
    const px = buf(3, 1);
    for (const x of [0, 1, 2]) set(px, 3, x, 0, 9, 9, 9, 255);
    largestRegion(px, 3, 1);
    expect([...px].filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255]);
  });

  // Diagonal-only contact is NOT connectivity: the pass is 4-connected, matching
  // the flood used by tests/images.test.ts's shell-fragment guard.
  it('treats diagonal touching as two regions', () => {
    const px = buf(2, 2);
    set(px, 2, 0, 0, 9, 9, 9, 255);
    set(px, 2, 1, 1, 9, 9, 9, 255);
    largestRegion(px, 2, 2);
    expect([...px].filter((_, i) => i % 4 === 3).filter((a) => a === 255)).toHaveLength(1);
  });
});

describe('borderFlood', () => {
  // Floods inward from the border through transparent and desaturated-light pixels,
  // stripping near-white matte residue. Saturated art blocks the flood.
  //
  // Uses a 3-row box, not the 1-row strip the brief's own draft used: in a 1-tall
  // image, row 0 and row h-1 are the SAME row, so every column is simultaneously a
  // top-border AND bottom-border pixel and gets seeded directly — there is no
  // "interior, walled off" position left to occupy, which contradicted that
  // fixture's own "walled off -> kept" comment (confirmed against the reference
  // implementation transcribed verbatim from the brief: it clears that pixel, not
  // keeps it). Corrected to a proper box: the strip of interest sits in the
  // non-border middle row, flanked above and below by an opaque wall, so the
  // "walled off" cell is genuinely interior and reachable only through its own row.
  it('clears a light matte reachable from the border but spares walled-off art', () => {
    const px = buf(4, 3);
    for (let x = 0; x < 4; x++) {
      set(px, 4, x, 0, 20, 180, 60, 255);  // top wall: saturated art blocks vertical entry
      set(px, 4, x, 2, 20, 180, 60, 255);  // bottom wall: same
    }
    set(px, 4, 0, 1, 250, 250, 250, 255);  // light matte at the border column -> cleared
    set(px, 4, 1, 1, 20, 180, 60, 255);    // saturated art -> blocks the flood
    set(px, 4, 2, 1, 250, 250, 250, 255);  // light, but walled off -> kept
    set(px, 4, 3, 1, 20, 180, 60, 255);    // art at the far border column
    borderFlood(px, 4, 3);
    expect(px[19]).toBe(0);
    expect(px[23]).toBe(255);
    expect(px[27]).toBe(255);
    expect(px[31]).toBe(255);
  });
});

describe('shave', () => {
  it('removes n rings of boundary pixels', () => {
    const px = buf(5, 5);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) set(px, 5, x, y, 9, 9, 9, 255);
    shave(px, 5, 5, 1);
    // Only the centre of the 3x3 block survives one ring of shaving.
    expect([...px].filter((_, i) => i % 4 === 3).filter((a) => a === 255)).toHaveLength(1);
    expect(px[(2 * 5 + 2) * 4 + 3]).toBe(255);
  });

  // The n=1 fixture above cannot tell "shaves n rings" from "always shaves exactly
  // one ring" — a mutant that ignores the n argument entirely is byte-identical on
  // it, while production always calls shave(px, w, h, 2) (scripts/fit-art.mjs). A
  // 5x5 block needs two rings to erode to its own single-pixel centre, which a
  // one-ring-only mutant would leave at a 3x3 (9 survivors), not 1.
  it('shaves exactly n rings, pinning n=2 as fit-art.mjs actually calls it', () => {
    const px = buf(7, 7);
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) set(px, 7, x, y, 9, 9, 9, 255);
    shave(px, 7, 7, 2);
    expect([...px].filter((_, i) => i % 4 === 3).filter((a) => a === 255)).toHaveLength(1);
    expect(px[(3 * 7 + 3) * 4 + 3]).toBe(255);
  });
});

describe('eggAxisBBox', () => {
  // Centres on the egg's own axis — the top ~45% of the silhouette — so asymmetric
  // nest dressing along the bottom does not push the egg off-centre.
  //
  // The original fixture proved the top-45% rule only LOOSELY: on a 10-row whole box
  // (cut = round(10*0.45) = 5) the egg's own column was the only opaque pixel above
  // the cut, so any cut fraction from roughly 0.1 to 0.9 would have produced the
  // identical result — the 0.45 constant itself was untested. Pinned here with a
  // boundary pair straddling the cut: a wide pixel at row 4 (just inside, y < cut)
  // must widen the measured extent, and a wider one at row 5 (the first row outside
  // the cut, where the nest skirt now starts) must not.
  it('measures x extent from the top 45% only', () => {
    const px = buf(10, 10);
    // Egg: a narrow column near the top, clear of the boundary rows below.
    for (let y = 0; y <= 2; y++) for (let x = 4; x <= 5; x++) set(px, 10, x, y, 9, 9, 9, 255);
    // Row 4 is the last row inside the cut (cut = 5) -> must widen the extent.
    set(px, 10, 8, 4, 9, 9, 9, 255);
    // Nest dressing starts at row 5, the first row outside the cut, and is wider
    // still -> must NOT widen the extent, even though it dwarfs everything above it.
    for (let y = 5; y <= 9; y++) for (let x = 4; x <= 9; x++) set(px, 10, x, y, 9, 9, 9, 255);
    const whole = { x0: 4, y0: 0, x1: 9, y1: 9 };
    const eggBox = eggAxisBBox(px, 10, 10, whole);
    expect(eggBox.x0).toBe(4);
    expect(eggBox.x1).toBe(8);
    // Vertical extent stays the whole silhouette — only the axis is re-measured.
    expect(eggBox.y0).toBe(0);
    expect(eggBox.y1).toBe(9);
  });
});

describe('fitDraw', () => {
  // fitBox drives scale and centring; box (the whole opaque source rectangle) is
  // drawn at that same scale. Pinned against the real post-shave numbers measured
  // off the committed assets/images/eggs/common.webp: box {76,26,967,997} (the whole
  // egg+nest silhouette), fitBox {195,26,829,997} (the egg-axis re-measurement).
  it('reproduces the committed common-egg geometry, centring the fit box exactly', () => {
    const box = { x0: 76, y0: 26, x1: 967, y1: 997 };
    const fitBox = { x0: 195, y0: 26, x1: 829, y1: 997 };
    const { scale, cx, cy } = fitDraw(box, fitBox, FIT_24, 1024);
    expect(cx).toBeCloseTo(73.7, 1);
    expect(cy).toBeCloseTo(24, 1);
    // The fit box's own centre — not the whole box's — must land exactly at the
    // canvas centre: that is what "centre the FIT box" means.
    const fw = fitBox.x1 - fitBox.x0 + 1;
    const fitBoxDestCentre = cx + (fitBox.x0 - box.x0) * scale + (fw * scale) / 2;
    expect(fitBoxDestCentre).toBeCloseTo(512, 6);
  });

  // --axis=egg's whole point is to shift the egg without cropping the nest, so
  // fitBox is always narrower-or-equal on the axis it biases while box (drawn at
  // fitBox's scale) can be much wider. A narrow fitBox inside a much wider box drives
  // the whole drawn rect off the S x S canvas. This is the case scripts/fit-art.mjs's
  // off-canvas guard exists to reject — a synthetic 300px egg centred in a 900px
  // nest (900 wide, 800 tall), matching the guard's own comment.
  it('can produce a drawn rect that overflows the canvas — the case the CLI guard rejects', () => {
    const box = { x0: 0, y0: 0, x1: 899, y1: 799 };     // 900x800 nest
    const fitBox = { x0: 300, y0: 0, x1: 599, y1: 799 }; // 300px-wide egg axis, centred
    const { scale, cx, cy } = fitDraw(box, fitBox, FIT_24, 1024);
    expect(scale).toBeCloseTo(1.22, 2);
    expect(cx).toBeCloseTo(-37, 1);
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    const R = cx + bw * scale, B = cy + bh * scale;
    expect(cx).toBeLessThan(-0.5);
    expect(R).toBeGreaterThan(1024.5);
  });

  // Swap guard: FIT_24 and FIT_31 select the margin for portrait vs. cutout in
  // scripts/fit-art.mjs (`mode === 'portrait' ? FIT_24 : FIT_31`), which is untested
  // wiring in a file that cannot itself be imported. Driving fitDraw — the actual
  // production scale/centre arithmetic — with each constant directly, on a square
  // box where box === fitBox, pins which margin each constant produces; swapping
  // FIT_24 and FIT_31 anywhere in the chain flips these two assertions.
  it('produces the 24px margin for FIT_24 and the 31px margin for FIT_31, never swapped', () => {
    const square = { x0: 0, y0: 0, x1: 1023, y1: 1023 };
    const portrait = fitDraw(square, square, FIT_24, 1024);
    const cutout = fitDraw(square, square, FIT_31, 1024);
    expect(Math.round(portrait.cx)).toBe(24);
    expect(Math.round(cutout.cx)).toBe(31);
  });
});
