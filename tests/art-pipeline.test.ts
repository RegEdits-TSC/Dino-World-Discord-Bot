import { describe, it, expect } from 'vitest';
import { coverGeometry, alphaThreshold, luminancePeel, opaqueBBox, COVER, Q, stripCaBX }
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
