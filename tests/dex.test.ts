import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen } from '../src/core/species-seen.js';
import { dexRows, dexEntry, dexProgress } from '../src/modules/dex/service.js';
import { dexListPayload, dexViewPayload } from '../src/modules/dex/embeds.js';
import { allSpecies } from '../src/data/species/index.js';
import { RARITY } from '../src/data/rarity.js';

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
    // rare has 9 species, of which ankylosaurus is the sole herbivore — the other 8
    // are carnivore (verified against src/data/species/*.ts). Unlike a mythic+carnivore
    // pair (all 3 mythic species are carnivore, so a dropped diet clause would still
    // pass), this pair has a real herbivore for a broken AND to leak through.
    const combo = dexRows(ctx, 'u1', { rarity: 'rare', diet: 'carnivore' });
    expect(combo).toHaveLength(8);
    expect(combo.some((r) => r.species.id === 'ankylosaurus')).toBe(false);
    for (const r of combo) {
      expect(r.species.rarity).toBe('rare');
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
    // Pinned against the live table, not just >0, so a field-swap bug (incomePerHr and
    // incubationMs assigned from each other) turns this red instead of staying green —
    // both fields are positive numbers on every tier, so >0 could not catch a swap.
    expect(e.incomePerHr).toBe(RARITY.common.incomePerHr);
    expect(e.incubationMs).toBe(RARITY.common.incubationMs);
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

describe('dexListPayload', () => {
  it('pages the roster ten at a time and clamps an out-of-range page', () => {
    const first = dexListPayload(ctx, 'u1', {}, 1);
    expect(JSON.stringify(first)).toContain('Page 1/5');
    const clamped = dexListPayload(ctx, 'u1', {}, 99);
    expect(JSON.stringify(clamped)).toContain('Page 5/5');
  });
  it('drops the page row when a filter fits on one page', () => {
    const payload = dexListPayload(ctx, 'u1', { rarity: 'mythic' }, 1);
    expect(payload.components ?? []).toHaveLength(0);
  });
  it('shows progress and marks a seen species', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const text = JSON.stringify(dexListPayload(ctx, 'u1', {}, 1));
    expect(text).toContain('1/42');
    expect(text).toContain('Triceratops');
  });
  it('renders an empty filter result without throwing', () => {
    // legendary+support is empty on the current roster — see the note in the dexRows
    // tests above for the other three empty pairs.
    const payload = dexListPayload(ctx, 'u1', { rarity: 'legendary', archetype: 'support' }, 1);
    expect(JSON.stringify(payload)).toContain('No species');
  });
});

describe('dexViewPayload', () => {
  it('names the decor kinds that enrich the species', () => {
    const text = JSON.stringify(dexViewPayload(ctx, 'u1', 'triceratops'));
    expect(text).toContain('Palm Tree');
    expect(text).toContain('Cycad Grove');
  });
  it('says so when the reader has never owned it', () => {
    expect(JSON.stringify(dexViewPayload(ctx, 'u1', 'triceratops'))).toContain('Never owned');
  });
  it('ships at most one file and never an empty files array', () => {
    const payload = dexViewPayload(ctx, 'u1', 'triceratops');
    // assetImage returns null for a missing asset and attach is then a total no-op,
    // so files must be undefined rather than [].
    expect(payload.files === undefined || payload.files.length === 1).toBe(true);
  });
});
