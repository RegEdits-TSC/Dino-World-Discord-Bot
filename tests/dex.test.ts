import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen } from '../src/core/species-seen.js';
import { dexRows, dexEntry, dexProgress } from '../src/modules/dex/service.js';
import { allSpecies } from '../src/data/species/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

describe('dexRows', () => {
  it('lists the whole roster in a stable order with seen marks', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const rows = dexRows(ctx, 'u1', {});
    expect(rows).toHaveLength(42);
    expect(rows.map((r) => r.species.id)).toEqual(allSpecies().map((s) => s.id));
    expect(rows.find((r) => r.species.id === 'triceratops')!.seen).toBe(true);
    expect(rows.find((r) => r.species.id === 'velociraptor')!.seen).toBe(false);
  });
  it('filters by rarity, diet and archetype, and combines them', () => {
    expect(dexRows(ctx, 'u1', { rarity: 'mythic' })).toHaveLength(3);
    expect(dexRows(ctx, 'u1', { diet: 'herbivore' })).toHaveLength(18);
    expect(dexRows(ctx, 'u1', { archetype: 'tank' })).toHaveLength(9);
    const combo = dexRows(ctx, 'u1', { rarity: 'mythic', diet: 'carnivore' });
    for (const r of combo) {
      expect(r.species.rarity).toBe('mythic');
      expect(r.species.diet).toBe('carnivore');
    }
  });
  // legendary+support is genuinely empty on the current roster (verified by counting
  // src/data/species/*.ts: the empty pairs are common+bruiser, rare+support,
  // legendary+support and mythic+support). If a future species fills it, move this to
  // another empty pair rather than deleting the case.
  it('returns an empty list when a filter combination matches nothing', () => {
    expect(dexRows(ctx, 'u1', { rarity: 'legendary', archetype: 'support' })).toEqual([]);
  });
});

describe('dexEntry', () => {
  it('carries the rarity-derived numbers and the enriching kinds', () => {
    const e = dexEntry(ctx, 'u1', 'triceratops');
    expect(e.species.name).toBe('Triceratops');
    expect(e.seen).toBe(false);
    expect(e.firstAt).toBeNull();
    expect(e.incomePerHr).toBeGreaterThan(0);
    expect(e.incubationMs).toBeGreaterThan(0);
    expect(e.enrichingKinds).toContain('palm_tree');
  });
  it('reports the first-owned instant once seen', () => {
    ctx.setNow(1_234);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const e = dexEntry(ctx, 'u1', 'triceratops');
    expect(e.seen).toBe(true);
    expect(e.firstAt).toBe(1_234);
  });
  it('throws on an unknown species, like getSpecies', () => {
    expect(() => dexEntry(ctx, 'u1', 'barney')).toThrow(/Unknown species/);
  });
});

describe('dexProgress', () => {
  it('counts seen against the full roster', () => {
    expect(dexProgress(ctx, 'u1')).toEqual({ seen: 0, total: 42 });
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(dexProgress(ctx, 'u1')).toEqual({ seen: 1, total: 42 });
  });
  it('ignores a seen species that is no longer in the roster', () => {
    recordSpeciesSeen(ctx, 'u1', 'retired_dino');
    expect(dexProgress(ctx, 'u1').seen).toBe(0);
  });
});
