import { describe, it, expect } from 'vitest';
import { coverGeometry, alphaThreshold, luminancePeel, opaqueBBox, COVER, Q }
  from '../scripts/lib/art-pipeline.mjs';

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
