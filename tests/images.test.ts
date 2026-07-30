import { describe, it, expect } from 'vitest';
import { Image, createCanvas } from '@napi-rs/canvas';
import { EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetImage, attach } from '../src/core/images.js';
import { CAMPAIGN } from '../src/data/battle/chapters/index.js';

const BANNERS = ['trading', 'leaderboards', 'help', 'care', 'care_neglect', 'shop_food_market',
  'battle_victory', 'battle_defeat', 'collect', 'rescue', 'dino_roster', 'eggs_incubator', 'sell'];

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
  it('ships every banner image listed in BANNERS', () => {
    for (const name of BANNERS) {
      const img = assetImage('banners', name);
      expect(img, name).not.toBeNull();
      expect(img!.url).toBe(`attachment://${name}.png`);
    }
  });
  it('accepts the battles kind and null-degrades when absent', () => {
    expect(assetImage('battles', 'no-such-portrait')).toBeNull();
  });
  it('accepts the hatch kind and null-degrades when absent', () => {
    expect(assetImage('hatch', 'no-such-crack')).toBeNull();
  });
});

describe('attach', () => {
  const blank = () => ({ embed: new EmbedBuilder().setTitle('t'), payload: {} as { files?: AttachmentBuilder[] } });

  it('is a total no-op for a null ref — no slot set, no files key created', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'image', null);
    attach(embed, payload, 'thumbnail', null);
    expect(embed.toJSON().image).toBeUndefined();
    expect(embed.toJSON().thumbnail).toBeUndefined();
    // Absent, NOT []. preHatchPayload and the notify handlers assert files is undefined.
    expect('files' in payload).toBe(false);
    expect(payload.files).toBeUndefined();
  });

  it('sets the image slot and attaches its file together', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'image', assetImage('eggs', 'common'));
    expect(embed.toJSON().image?.url).toBe('attachment://common.png');
    expect(embed.toJSON().thumbnail).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['common.png']);
  });

  it('sets the thumbnail slot and attaches its file together', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'common'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://common.png');
    expect(embed.toJSON().image).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['common.png']);
  });

  it('appends rather than assigns, so two calls both survive in call order', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'epic'));
    attach(embed, payload, 'image', assetImage('banners', 'eggs_incubator'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://epic.png');
    expect(embed.toJSON().image?.url).toBe('attachment://eggs_incubator.png');
    expect(payload.files!.map((f) => f.name)).toEqual(['epic.png', 'eggs_incubator.png']);
  });

  it("appends onto a pre-initialised files array (revealPayload's shape)", () => {
    const embed = new EmbedBuilder().setTitle('t');
    const payload: { files: AttachmentBuilder[]; attachments: never[] } = { files: [], attachments: [] };
    attach(embed, payload, 'image', assetImage('hatch', 'rare-crack'));
    expect(payload.files.map((f) => f.name)).toEqual(['rare-crack.png']);
    expect(payload.attachments).toEqual([]);
  });

  it('a missing asset between two present ones leaves the others untouched', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'epic'));
    attach(embed, payload, 'image', assetImage('banners', 'no-such-banner'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://epic.png');
    expect(embed.toJSON().image).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['epic.png']);
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

const PORTRAIT_BOSS_IDS = CAMPAIGN.map((c) => c.stages[4].boss!.bossId);

describe('boss portrait art', () => {
  it.each(PORTRAIT_BOSS_IDS)('%s is a 1024×1024 transparent cutout', (bossId) => expectTransparentPortrait(bossId));
});

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;

describe('hatch crack art', () => {
  // 1024×1024 transparent, same square as the eggs they are edited from — NOT
  // banner-sized, so they never belong in the BANNERS size loop above.
  it.each(RARITIES)('%s-crack ships at 1024x1024 with transparent corners', async (rarity) => {
    const ref = assetImage('hatch', `${rarity}-crack`);
    expect(ref, rarity).not.toBeNull();
    expect(ref!.url).toBe(`attachment://${rarity}-crack.png`);
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/hatch', `${rarity}-crack.png`));
    await img.decode();
    expect(img.width).toBe(1024);
    expect(img.height).toBe(1024);
    const canvas = createCanvas(img.width, img.height);
    const c2d = canvas.getContext('2d');
    c2d.drawImage(img, 0, 0);
    const px = c2d.getImageData(0, 0, img.width, img.height).data;
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]] as const) {
      expect(px[(y * img.width + x) * 4 + 3], `corner ${x},${y}`).toBe(0);
    }
  });

  // The cracks are the one cutout family that MUST keep several disconnected
  // alpha regions: the prompt asks for shell fragments falling away, and a
  // fragment clear of the nest is its own opaque island. prompts.md's egg pass
  // opens with "keep only the largest connected region" and verifies "exactly
  // one connected region" — applying either step here silently deletes the
  // fragments and leaves a plain open egg, which every size/corner check above
  // still passes. This is the gate for that: a blanket single-region pass over
  // the set takes the count below to 0. Individual cracks may legitimately land
  // at one region (`mythic` does), so the assertion is on the set, not per file.
  it('keeps the falling shell fragments — the set is not reduced to one region each', async () => {
    const counts: Record<string, number> = {};
    for (const rarity of RARITIES) {
      const img = new Image();
      img.src = readFileSync(resolve(process.cwd(), 'assets/images/hatch', `${rarity}-crack.png`));
      await img.decode();
      const canvas = createCanvas(img.width, img.height);
      const c2d = canvas.getContext('2d');
      c2d.drawImage(img, 0, 0);
      const px = c2d.getImageData(0, 0, img.width, img.height).data;
      const w = img.width, total = w * img.height;
      const seen = new Uint8Array(total);
      const stack = new Int32Array(total);
      let regions = 0;
      for (let start = 0; start < total; start++) {
        if (seen[start] || px[start * 4 + 3] === 0) continue;
        regions++;
        let top = 0;
        stack[top++] = start;
        seen[start] = 1;
        while (top > 0) {
          const p = stack[--top];
          const x = p % w;
          if (x > 0 && !seen[p - 1] && px[(p - 1) * 4 + 3] !== 0) { seen[p - 1] = 1; stack[top++] = p - 1; }
          if (x < w - 1 && !seen[p + 1] && px[(p + 1) * 4 + 3] !== 0) { seen[p + 1] = 1; stack[top++] = p + 1; }
          if (p >= w && !seen[p - w] && px[(p - w) * 4 + 3] !== 0) { seen[p - w] = 1; stack[top++] = p - w; }
          if (p + w < total && !seen[p + w] && px[(p + w) * 4 + 3] !== 0) { seen[p + w] = 1; stack[top++] = p + w; }
        }
      }
      counts[rarity] = regions;
    }
    const multiRegion = RARITIES.filter((r) => counts[r] > 1);
    expect(multiRegion.length, `region counts: ${JSON.stringify(counts)}`).toBeGreaterThan(0);
  });
});
