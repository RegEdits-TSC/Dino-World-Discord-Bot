import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, mulberry32 } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { incubateEgg, hatchEgg } from '../src/modules/hatchery/service.js';
import { locksFor } from '../src/core/locks.js';
import {
  startBreeding, claimBreeding, inheritTraits, activeBreedings, breedCooldowns, BreedError, spliceDino,
} from '../src/modules/genelab/service.js';
import { TRAITS } from '../src/data/traits.js';
import { BREED_MS, BREED_FEE, BREED_COOLDOWN_MS, SPLICE_SHARD_COST } from '../src/data/breeding.js';

function park(ctx: ReturnType<typeof makeCtx>, id = 'u1') {
  getOrCreateUser(ctx, id, id);
  ctx.economy.apply(id, { cash: 500_000 }, 'test', 0);
  buildLot(ctx, id, 'gene_lab');
  buildLot(ctx, id, 'herbivore_paddock');
  return ctx.db.select().from(schema.lots).all().find((l) => l.kind === 'herbivore_paddock')!;
}

function dino(ctx: ReturnType<typeof makeCtx>, opts: Partial<{ species: string; lotId: number; hunger: number; traits: string[]; viaTrade: boolean }> = {}) {
  return ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: opts.species ?? 'triceratops', lotId: opts.lotId ?? null,
    hunger: opts.hunger ?? 100, lastFedAt: 0, hatchedAt: 0,
    traits: opts.traits ?? [], viaTrade: opts.viaTrade ?? false,
  }).returning().get();
}

describe('startBreeding', () => {
  it('charges the fee and schedules the pairing', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const before = ctx.db.select().from(schema.users).all()[0].cash;

    const br = startBreeding(ctx, 'u1', a.id, b.id, null);

    expect(br.rarity).toBe('common');
    expect(br.readyAt).toBe(BREED_MS.common);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before - BREED_FEE.common);
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(1);
  });

  it('shortens the wait for a Fertile parent', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id, traits: ['fertile'] });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    expect(startBreeding(ctx, 'u1', a.id, b.id, null).readyAt).toBe(BREED_MS.common * 0.75);
  });

  it('refuses mismatched rarity', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'stegosaurus', lotId: lot.id });
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/same rarity/);
  });

  it('refuses mismatched diet', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'compsognathus', lotId: lot.id });
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/same diet/);
  });

  it('refuses the same dino twice', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    expect(() => startBreeding(ctx, 'u1', a.id, a.id, null)).toThrow(/two different/);
  });

  it('refuses a dino somebody else owns', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.update(schema.dinos).set({ userId: 'u2' }).where(eq(schema.dinos.id, b.id)).run();
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(BreedError);
  });

  it('refuses an unassigned dino', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus' });
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/paddock/);
  });

  it('refuses an escaped dino', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    ctx.db.update(schema.dinos).set({ escapedAt: 0 }).where(eq(schema.dinos.id, b.id)).run();
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/escaped/);
  });

  it('refuses a hungry dino', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id, hunger: 20 });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/hungry/);
  });

  it('refuses a dino that has drained below the gate since it was last fed', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    // 30 h of the 48 h drain window = 62.5 hunger drained, so both parents sit at
    // 37.5 — under the gate even though the stored column still reads 100.
    ctx.setNow(30 * 3_600_000);
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/hungry/);
  });

  it('refuses mythics', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { species: 'indominus', lotId: lot.id });
    const b = dino(ctx, { species: 'indoraptor', lotId: lot.id });
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/Mythic/);
  });

  it('refuses without a Gene Lab', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { cash: 500_000 }, 'test', 0);
    buildLot(ctx, 'u1', 'herbivore_paddock');
    const lot = ctx.db.select().from(schema.lots).all()[0];
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/Gene Lab/);
  });

  it('refuses beyond the slot count', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const c = dino(ctx, { species: 'dryosaurus', lotId: lot.id });
    const d = dino(ctx, { species: 'othnielia', lotId: lot.id });
    startBreeding(ctx, 'u1', a.id, b.id, null);
    expect(() => startBreeding(ctx, 'u1', c.id, d.id, null)).toThrow(/slots/);
  });

  it('refuses a parent already busy breeding', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    // Upgrade the lab to 2 slots so the second start fails on the LOCK, not the slot cap.
    const lab = ctx.db.select().from(schema.lots).all().find((l) => l.kind === 'gene_lab')!;
    ctx.db.update(schema.lots).set({ level: 2 }).where(eq(schema.lots.id, lab.id)).run();
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const c = dino(ctx, { species: 'dryosaurus', lotId: lot.id });
    startBreeding(ctx, 'u1', a.id, b.id, null);
    expect(() => startBreeding(ctx, 'u1', a.id, c.id, null)).toThrow(/busy|locked/i);
  });

  it('refuses a parent still cooling down', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    claimBreeding(ctx, 'u1', br.id);
    ctx.setNow(br.readyAt + 1);
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/cooling down/);
  });

  it('lets a cooled-down pair breed again', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    claimBreeding(ctx, 'u1', br.id);
    ctx.setNow(br.readyAt + BREED_COOLDOWN_MS.common);
    // Both parents drained ~2% over the 60 min elapsed, so the hunger gate is not in play.
    expect(startBreeding(ctx, 'u1', a.id, b.id, null).id).toBeGreaterThan(br.id);
  });

  it('refuses when the fee cannot be paid, as a BreedError and not an economy throw', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    ctx.db.update(schema.users).set({ cash: BREED_FEE.common - 1 }).where(eq(schema.users.discordId, 'u1')).run();
    // Not InsufficientFundsError: the check is in the shared block, so /breed has one
    // error class to catch and the dry run refuses this pairing too.
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(BreedError);
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).toThrow(/costs 200 cash — you have 199/);
    expect(ctx.db.select().from(schema.breedings).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(0);
  });

  it('allows a pairing the player can exactly afford', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    ctx.db.update(schema.users).set({ cash: BREED_FEE.common }).where(eq(schema.users.discordId, 'u1')).run();
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null)).not.toThrow();
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(0);
  });
});

describe('startBreeding dryRun', () => {
  it('validates and previews without charging, inserting or scheduling', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id, traits: ['fertile'] });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const before = ctx.db.select().from(schema.users).all()[0].cash;

    const preview = startBreeding(ctx, 'u1', a.id, b.id, null, { dryRun: true });

    expect(preview.rarity).toBe('common');
    expect(preview.readyAt).toBe(BREED_MS.common * 0.75);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before);
    expect(ctx.db.select().from(schema.breedings).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.timers).all()).toHaveLength(0);
    expect(activeBreedings(ctx, 'u1')).toHaveLength(0);
    // The preview consumed no slot and left no lock, so the real start still passes.
    expect(startBreeding(ctx, 'u1', a.id, b.id, null).readyAt).toBe(preview.readyAt);
  });

  it('refuses a pair the real start would refuse', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'stegosaurus', lotId: lot.id });
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null, { dryRun: true })).toThrow(/same rarity/);
  });

  it('refuses a preview the player cannot afford — the confirm button never sees the fee fail', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { species: 'tyrannosaurus', lotId: lot.id });
    const b = dino(ctx, { species: 'mosasaurus', lotId: lot.id });
    ctx.db.update(schema.users).set({ cash: 100 }).where(eq(schema.users.discordId, 'u1')).run();
    // The exact case the preview exists for: a clean dry run followed by a confirm that
    // throws InsufficientFundsError from inside the transaction.
    expect(() => startBreeding(ctx, 'u1', a.id, b.id, null, { dryRun: true }))
      .toThrow(/costs 40,000 cash — you have 100/);
  });
});

describe('activeBreedings and breedCooldowns', () => {
  it('lists the pending pairing, then derives both parents cooldowns from the claim', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);

    expect(activeBreedings(ctx, 'u1').map((x) => x.id)).toEqual([br.id]);
    expect(breedCooldowns(ctx, 'u1').size).toBe(0);   // nothing claimed yet

    ctx.setNow(br.readyAt);
    claimBreeding(ctx, 'u1', br.id);

    expect(activeBreedings(ctx, 'u1')).toHaveLength(0);
    const cd = breedCooldowns(ctx, 'u1');
    expect(cd.get(a.id)).toBe(br.readyAt + BREED_COOLDOWN_MS.common);
    expect(cd.get(b.id)).toBe(br.readyAt + BREED_COOLDOWN_MS.common);
  });
});

describe('claimBreeding', () => {
  it('produces an egg of the parents rarity and releases the parents', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);

    const { egg } = claimBreeding(ctx, 'u1', br.id);
    expect(egg.source).toBe('breeding');
    expect(['common', 'uncommon']).toContain(egg.rarity);
    expect(activeBreedings(ctx, 'u1')).toHaveLength(0);
    expect(locksFor(ctx, 'u1').dinos.size).toBe(0);
  });

  it('refuses before readyAt', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt - 1);
    expect(() => claimBreeding(ctx, 'u1', br.id)).toThrow(/not ready/);
  });

  it('refuses a second claim, and a claim by anyone but the owner', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    expect(() => claimBreeding(ctx, 'u2', br.id)).toThrow(/No such breeding/);
    claimBreeding(ctx, 'u1', br.id);
    expect(() => claimBreeding(ctx, 'u1', br.id)).toThrow(/already been claimed/);
    expect(ctx.db.select().from(schema.eggs).all()).toHaveLength(1);
  });

  it('pins the species when both parents match, and leaves it null otherwise', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    expect(claimBreeding(ctx, 'u1', br.id).egg.speciesId).toBe('triceratops');

    const ctx2 = makeCtx({ nowMs: 0 });
    const lot2 = park(ctx2);
    const c = dino(ctx2, { lotId: lot2.id });
    const d = dino(ctx2, { species: 'gallimimus', lotId: lot2.id });
    const br2 = startBreeding(ctx2, 'u1', c.id, d.id, null);
    ctx2.setNow(br2.readyAt);
    expect(claimBreeding(ctx2, 'u1', br2.id).egg.speciesId).toBeNull();
  });

  it('propagates viaTrade from either parent', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id, viaTrade: true });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    expect(claimBreeding(ctx, 'u1', br.id).egg.viaTrade).toBe(true);

    // ...and from the SECOND parent, which an `a.viaTrade`-only read would miss.
    const ctx2 = makeCtx({ nowMs: 0 });
    const lot2 = park(ctx2);
    const c = dino(ctx2, { lotId: lot2.id });
    const d = dino(ctx2, { species: 'gallimimus', lotId: lot2.id, viaTrade: true });
    const br2 = startBreeding(ctx2, 'u1', c.id, d.id, null);
    ctx2.setNow(br2.readyAt);
    expect(claimBreeding(ctx2, 'u1', br2.id).egg.viaTrade).toBe(true);
  });

  it('leaves viaTrade false when neither parent was traded for', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    expect(claimBreeding(ctx, 'u1', br.id).egg.viaTrade).toBe(false);
  });

  it('never upgrades a legendary pair, so breeding cannot mint a mythic', () => {
    const ctx = makeCtx({ nowMs: 0, rng: () => 0 });   // rng 0 always takes the upgrade branch
    const lot = park(ctx);
    const a = dino(ctx, { species: 'tyrannosaurus', lotId: lot.id });
    const b = dino(ctx, { species: 'mosasaurus', lotId: lot.id });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    const res = claimBreeding(ctx, 'u1', br.id);
    expect(res.egg.rarity).toBe('legendary');
    // The roll fired but changed nothing: reporting `true` here would be a lie to the UI.
    expect(res.upgraded).toBe(false);
  });

  it('reports the upgrade when the rarity really does move up a tier', () => {
    const ctx = makeCtx({ nowMs: 0, rng: () => 0 });   // rng 0 always takes the upgrade branch
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id });
    const b = dino(ctx, { lotId: lot.id });             // same species, so only the upgrade can null the species
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);
    const res = claimBreeding(ctx, 'u1', br.id);
    expect(res.egg.rarity).toBe('uncommon');
    expect(res.upgraded).toBe(true);
    expect(res.egg.speciesId).toBeNull();   // an upgraded egg cannot inherit the parents' species
  });

  it('stores the inherited traits on the egg and on the claimed row', () => {
    // Constant 0.5: no upgrade (0.5 >= 0.10), one slot, and the inherit branch
    // draws pool[1]. A mutation would draw TRAIT_IDS[7] = 'savage' instead.
    const ctx = makeCtx({ nowMs: 0, rng: () => 0.5 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id, traits: ['hardy'] });
    const b = dino(ctx, { species: 'gallimimus', lotId: lot.id, traits: ['fleet'] });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);

    const { egg } = claimBreeding(ctx, 'u1', br.id);
    expect(egg.traits).toEqual(['fleet']);
    const row = ctx.db.select().from(schema.breedings).where(eq(schema.breedings.id, br.id)).get()!;
    expect(row.traits).toEqual(['fleet']);
    expect(row.claimedAt).toBe(br.readyAt);
  });

  it('carries bred traits and trade provenance all the way through the hatch', () => {
    const ctx = makeCtx({ nowMs: 0, rng: () => 0.5 });
    const lot = park(ctx);
    const a = dino(ctx, { lotId: lot.id, traits: ['hardy'], viaTrade: true });
    const b = dino(ctx, { lotId: lot.id, traits: ['fleet'] });
    const br = startBreeding(ctx, 'u1', a.id, b.id, null);
    ctx.setNow(br.readyAt);

    const { egg } = claimBreeding(ctx, 'u1', br.id);
    const inc = incubateEgg(ctx, 'u1', egg.id, null);
    ctx.setNow(inc.hatchesAt!);
    const hatched = hatchEgg(ctx, 'u1', egg.id);

    expect(hatched.traits).toEqual(['fleet']);
    const child = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, hatched.dinoId)).get()!;
    expect(child.speciesId).toBe('triceratops');
    expect(child.viaTrade).toBe(true);   // sells for 0 shards, like the parent it came from
  });
});

describe('inheritTraits', () => {
  it('produces only mutations when both parents are blank', () => {
    for (let seed = 0; seed < 100; seed++) {
      const out = inheritTraits([], [], mulberry32(seed));
      expect(out.length).toBeLessThanOrEqual(2);
      expect(new Set(out.map((id) => TRAITS[id as keyof typeof TRAITS].domain)).size).toBe(out.length);
    }
  });

  it('never returns two traits from one domain', () => {
    for (let seed = 0; seed < 300; seed++) {
      const out = inheritTraits(['prolific', 'savage'], ['runt', 'fleet'], mulberry32(seed));
      const domains = out.map((id) => TRAITS[id as keyof typeof TRAITS].domain);
      expect(new Set(domains).size).toBe(domains.length);
    }
  });

  it('draws from the parent pool most of the time', () => {
    const pool = new Set(['hardy', 'savage']);
    let fromPool = 0, total = 0;
    for (let seed = 0; seed < 400; seed++) {
      for (const t of inheritTraits(['hardy'], ['savage'], mulberry32(seed))) {
        total++;
        if (pool.has(t)) fromPool++;
      }
    }
    expect(fromPool / total).toBeGreaterThan(0.5);
  });

  it('rolls slot counts on the bred odds, which beat a wild hatch', () => {
    const counts = [0, 0, 0];
    for (let seed = 0; seed < 2000; seed++) counts[inheritTraits([], [], mulberry32(seed)).length]++;
    // BRED_SLOT_ODDS = [0.25, 0.45, 0.30]; WILD_SLOT_ODDS = [0.55, 0.35, 0.10].
    expect(counts[0] / 2000).toBeGreaterThan(0.20);
    expect(counts[0] / 2000).toBeLessThan(0.30);
    expect(counts[2] / 2000).toBeGreaterThan(0.25);
    expect(counts[2] / 2000).toBeLessThan(0.35);
  });

  it('ignores trait ids that are no longer in the table', () => {
    const out = inheritTraits(['retired_trait'], [], () => 0.5);
    expect(out).toEqual(['savage']);   // pool empty after the filter, so slot 0 mutates
  });
});

describe('spliceDino', () => {
  it('charges shards and replaces the chosen slot', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { shards: 100 }, 'test', 0);
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
      traits: ['prolific', 'savage'],
    }).returning().get();

    const out = spliceDino(ctx, 'u1', d.id, 0);
    expect(out.before).toEqual(['prolific', 'savage']);
    expect(out.after[1]).toBe('savage');
    expect(ctx.db.select().from(schema.users).all()[0].shards).toBe(100 - SPLICE_SHARD_COST);
    expect(ctx.db.select().from(schema.dinos).all()[0].traits).toEqual(out.after);
  });

  it('adds a trait to a blank dino', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { shards: 100 }, 'test', 0);
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    expect(spliceDino(ctx, 'u1', d.id, 0).after).toHaveLength(1);
  });

  it('refuses without enough shards', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    expect(() => spliceDino(ctx, 'u1', d.id, 0)).toThrow();
  });

  it('refuses a locked dino', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { shards: 100 }, 'test', 0);
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: d.id, parentB: d.id, rarity: 'common', startedAt: 0, readyAt: 10,
    }).run();
    expect(() => spliceDino(ctx, 'u1', d.id, 0)).toThrow(/busy|locked/i);
  });

  // A forged `splice:confirm:<id>:0.5` customId used to reach this far: 0.5 passes a
  // Number.isFinite check and the old range check (0.5 <= Math.min(2, 1) = 1), then hit
  // spliceTrait, where `out[0.5] = picked` sets a non-index property JSON.stringify drops
  // silently — economy.apply had already debited shards inside the same transaction, so
  // the net effect was shards destroyed with the trait array unchanged and no error. The
  // guard must live in spliceDino itself, not just in the button handler's customId
  // parsing, so the service stays safe regardless of what a caller validates.
  it('refuses a fractional slot and debits no shards', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { shards: 100 }, 'test', 0);
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
      traits: ['prolific', 'savage'],
    }).returning().get();

    expect(() => spliceDino(ctx, 'u1', d.id, 0.5)).toThrow();
    expect(ctx.db.select().from(schema.users).all()[0].shards).toBe(100);
    expect(ctx.db.select().from(schema.dinos).all()[0].traits).toEqual(['prolific', 'savage']);
  });
});
