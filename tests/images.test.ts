import { describe, it, expect } from 'vitest';
import { Image } from '@napi-rs/canvas';
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
