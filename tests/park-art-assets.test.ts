import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Image } from '@napi-rs/canvas';

const PARK_DIR = resolve(process.cwd(), 'assets/images/park');

// Raster decode (PNG and WebP alike) is async in @napi-rs/canvas: an un-awaited decode reports the
// right width/height while the pixels are still blank, so dimension checks alone would pass on a
// truncated download.
async function decodeRaster(bytes: Buffer): Promise<Image> {
  const i = new Image();
  i.src = bytes;
  await i.decode();
  return i;
}

describe('park map art', () => {
  it('ground.webp decodes and is wider than tall (it is cover-scaled to the canvas, never tiled)', async () => {
    const img = await decodeRaster(readFileSync(resolve(PARK_DIR, 'ground.webp')));
    expect(img.width).toBeGreaterThan(0);
    expect(img.width / img.height).toBeGreaterThan(1);
  });

  // Plates AND landmarks draw 1:1 at TILE_W×TILE_H (draw.ts's drawTile / drawLandmark, respectively).
  // Committing any of them at exactly that size is what keeps a square (or otherwise mis-sized)
  // generation from being silently squashed/stretched into the tile — a defect that renders
  // "successfully" (drawImage never throws on a mismatched raster size) and just looks wrong.
  it.each(['plate-paddock.webp', 'plate-facility.webp', 'landmark-a.webp', 'landmark-b.webp', 'landmark-c.webp'])('%s decodes at the 270×150 tile size', async (f) => {
    const img = await decodeRaster(readFileSync(resolve(PARK_DIR, f)));
    expect(img.width).toBe(270);
    expect(img.height).toBe(150);
  });
});
