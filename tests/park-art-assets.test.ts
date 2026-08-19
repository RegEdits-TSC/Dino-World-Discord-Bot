import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Image } from '@napi-rs/canvas';
import { ATTRACTIONS } from '../src/data/attractions.js';

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

  // Plates, landmarks AND attraction bands draw 1:1 at TILE_W×TILE_H (draw.ts's drawTile /
  // drawLandmark / drawAttraction, respectively). Committing any of them at exactly that size is
  // what keeps a square (or otherwise mis-sized) generation from being silently squashed/stretched
  // into the tile — a defect that renders "successfully" (drawImage never throws on a mismatched
  // raster size) and just looks wrong.
  it.each([
    'plate-paddock.webp', 'plate-facility.webp',
    'landmark-a.webp', 'landmark-b.webp', 'landmark-c.webp',
    'attraction-picnic_lawn.webp', 'attraction-gift_shop.webp', 'attraction-viewing_platform.webp',
    'attraction-amber_carousel.webp', 'attraction-sky_gondola.webp', 'attraction-grand_atrium.webp',
  ])('%s decodes at the 270×150 tile size', async (f) => {
    const img = await decodeRaster(readFileSync(resolve(PARK_DIR, f)));
    expect(img.width).toBe(270);
    expect(img.height).toBe(150);
  });

  // The inverse of the banner orphan check, and the only guard on the slug spelling. These rasters
  // load through loadParkArt, not assetImage, and a basename that does not match its ATTRACTIONS
  // key never throws: the lookup misses, drawAttraction takes its null branch, and the cell falls
  // back to the flat #2d4a63 fill — indistinguishable from "art not shipped yet". Enumerating the
  // directory is what turns attraction-gift-shop.webp against the slug gift_shop into a failure.
  // Set equality asserts both directions: an unknown basename fails here, a missing file fails the
  // size list above with ENOENT.
  it('names every committed attraction band after a real ATTRACTIONS key', () => {
    const kinds = Object.keys(ATTRACTIONS);
    const committed = readdirSync(PARK_DIR)
      .filter((f) => f.startsWith('attraction-') && f.endsWith('.webp'))
      .map((f) => f.slice('attraction-'.length, -'.webp'.length));
    for (const kind of committed) {
      expect(kinds, `assets/images/park/attraction-${kind}.webp does not name an ATTRACTIONS kind`).toContain(kind);
    }
    expect([...committed].sort()).toEqual([...kinds].sort());
  });
});
