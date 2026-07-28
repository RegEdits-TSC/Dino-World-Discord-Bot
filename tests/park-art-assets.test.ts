import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Image } from '@napi-rs/canvas';

const PARK_DIR = resolve(process.cwd(), 'assets/images/park');

// PNG decode is async in @napi-rs/canvas: an un-awaited decode reports the right width/height while
// the pixels are still blank, so dimension checks alone would pass on a truncated download.
async function decodePng(png: Buffer): Promise<Image> {
  const i = new Image();
  i.src = png;
  await i.decode();
  return i;
}

describe('park map art', () => {
  it('ground.png decodes and is wider than tall (it is cover-scaled to the canvas, never tiled)', async () => {
    const img = await decodePng(readFileSync(resolve(PARK_DIR, 'ground.png')));
    expect(img.width).toBeGreaterThan(0);
    expect(img.width / img.height).toBeGreaterThan(1);
  });

  // Plates draw 1:1 at TILE_W×TILE_H (draw.ts). Committing them at exactly that size is what keeps a
  // square generation from being silently squashed to 1.8:1 in the tile — the one plate defect that
  // renders "successfully" and looks wrong.
  it.each(['plate-paddock.png', 'plate-facility.png'])('%s decodes at the 270×150 tile size', async (f) => {
    const img = await decodePng(readFileSync(resolve(PARK_DIR, f)));
    expect(img.width).toBe(270);
    expect(img.height).toBe(150);
  });
});
