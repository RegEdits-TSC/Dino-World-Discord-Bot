import { describe, it, expect } from 'vitest';
import { createCanvas, Image } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetImage } from '../src/core/images.js';

const BANNERS = ['trading', 'leaderboards', 'help', 'care', 'care_neglect'];

describe('assetImage', () => {
  it('returns an attachment ref for a present file', () => {
    const img = assetImage('eggs', 'common');
    expect(img).not.toBeNull();
    expect(img!.url).toBe('attachment://common.png');
    expect(img!.file.name).toBe('common.png');
  });
  it('returns null for a missing file', () => {
    expect(assetImage('eggs', 'no-such-rarity')).toBeNull();
    expect(assetImage('sites', 'no-such-site-banner')).toBeNull();
  });
  it('caches existence checks (same answer on repeat calls)', () => {
    expect(assetImage('eggs', 'mythic')).not.toBeNull();
    expect(assetImage('eggs', 'mythic')).not.toBeNull();
  });
  it('accepts the banners kind and null-degrades when absent', () => {
    expect(assetImage('banners', 'no-such-banner')).toBeNull();
  });
  it('ships all five banner images', () => {
    for (const name of BANNERS) {
      const img = assetImage('banners', name);
      expect(img, name).not.toBeNull();
      expect(img!.url).toBe(`attachment://${name}.png`);
    }
  });
  it('accepts the battles kind and null-degrades when absent', () => {
    expect(assetImage('battles', 'no-such-portrait')).toBeNull();
  });
});

describe('banner art', () => {
  // Discord scales an embed image to the embed width, so an off-size banner
  // letterboxes or crops; 1536×1024 matches the site banners already shipping.
  it.each(BANNERS)('%s is 1536×1024', async (name) => {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', `${name}.png`));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });
});

// A re-export that bakes the flat light-gray studio background back in passes
// any size-only check and then reads as a gray card in dark mode, so corners
// are asserted transparent, not just the dimensions. These are the only
// committed images used as an embed thumbnail over the viewer's theme.
async function expectTransparentPortrait(bossId: string): Promise<void> {
  expect(assetImage('battles', `${bossId}-portrait`), bossId).not.toBeNull();
  const img = new Image();
  img.src = readFileSync(resolve(process.cwd(), 'assets/images/battles', `${bossId}-portrait.png`));
  await img.decode();   // PNG decode is async — drawing without it silently yields a blank canvas
  expect(img.width, bossId).toBe(1024);
  expect(img.height, bossId).toBe(1024);
  const canvas = createCanvas(1024, 1024);
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0);
  const corners: Array<[number, number]> = [[0, 0], [1023, 0], [0, 1023], [1023, 1023]];
  for (const [x, y] of corners) {
    expect(c.getImageData(x, y, 1, 1).data[3], `${bossId} corner ${x},${y}`).toBe(0);
  }
}

describe('boss portrait art', () => {
  it('boss-coastal_dig is a 1024×1024 transparent cutout', () => expectTransparentPortrait('boss-coastal_dig'));
});
