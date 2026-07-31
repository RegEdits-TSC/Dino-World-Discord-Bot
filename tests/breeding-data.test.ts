import { describe, it, expect } from 'vitest';
import {
  BREED_MS, BREED_FEE, BREED_COOLDOWN_MS, BREED_UPGRADE_CHANCE,
  BREED_MIN_HUNGER, SPLICE_SHARD_COST, upgradeRarity, breedableRarity,
} from '../src/data/breeding.js';
import { SHOP_EGG_PRICES } from '../src/data/shop.js';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';

describe('breeding constants', () => {
  it('prices every breedable rarity between 30% and 45% of the shop egg price', () => {
    for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const) {
      const ratio = BREED_FEE[r] / SHOP_EGG_PRICES[r];
      expect(ratio).toBeGreaterThanOrEqual(0.30);
      expect(ratio).toBeLessThanOrEqual(0.45);
    }
  });

  it('refuses to breed mythics', () => {
    expect(breedableRarity('mythic')).toBe(false);
    expect(breedableRarity('legendary')).toBe(true);
  });

  it('caps the rarity upgrade at legendary so breeding can never mint a mythic', () => {
    expect(upgradeRarity('rare')).toBe('epic');
    expect(upgradeRarity('epic')).toBe('legendary');
    expect(upgradeRarity('legendary')).toBe('legendary');
  });

  it('sets cooldown equal to breeding time', () => {
    for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const) {
      expect(BREED_COOLDOWN_MS[r]).toBe(BREED_MS[r]);
    }
  });

  it('pins the splice cost and the hunger gate', () => {
    expect(SPLICE_SHARD_COST).toBe(15);
    expect(BREED_MIN_HUNGER).toBe(50);
    expect(BREED_UPGRADE_CHANCE).toBe(0.10);
  });
});

describe('schema migration', () => {
  it('creates the breedings table and defaults traits to an empty array', () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const dino = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    expect(dino.traits).toEqual([]);

    const egg = ctx.db.insert(schema.eggs).values({
      userId: 'u1', rarity: 'rare', source: 'shop', obtainedAt: 0,
    }).returning().get();
    expect(egg.traits).toEqual([]);

    const b = ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: dino.id, parentB: dino.id, rarity: 'rare',
      startedAt: 0, readyAt: 100,
    }).returning().get();
    expect(b.claimedAt).toBeNull();
    expect(b.traits).toEqual([]);
    expect(b.viaTrade).toBe(false);
  });
});
