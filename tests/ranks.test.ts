import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen } from '../src/core/species-seen.js';
import { allSpecies } from '../src/data/species/index.js';
import { ACHIEVEMENTS } from '../src/data/achievements.js';
import { CAMPAIGN } from '../src/data/battle/chapters/index.js';
import { LEGACY_TIERS, legacyMaxPoints, legacyPoints, legacyRank, bumpLegacyBest } from '../src/modules/park/ranks.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

describe('legacy ceiling', () => {
  // Derived, never a literal: new species, achievement tracks or chapters must move it,
  // or the top rank silently becomes unreachable (or trivially reachable).
  it('is the sum of the three content maxima', () => {
    const species = allSpecies().length;
    const tiers = ACHIEVEMENTS.reduce((s, t) => s + t.tiers.length, 0);
    const stars = CAMPAIGN.reduce((s, c) => s + c.stages.length * 3, 0);
    expect(legacyMaxPoints()).toBe(species + tiers + stars);
    expect(legacyMaxPoints()).toBe(190);      // 52 + 48 + 90 on today's content
  });
  it('leaves the top tier reachable', () => {
    expect(LEGACY_TIERS[LEGACY_TIERS.length - 1].points).toBeLessThanOrEqual(legacyMaxPoints());
  });
  it('is six ascending tiers', () => {
    expect(LEGACY_TIERS).toHaveLength(6);
    for (let i = 1; i < LEGACY_TIERS.length; i++) {
      expect(LEGACY_TIERS[i].points).toBeGreaterThan(LEGACY_TIERS[i - 1].points);
      expect(LEGACY_TIERS[i].rank).toBe(LEGACY_TIERS[i - 1].rank + 1);
    }
  });
});

describe('legacyPoints', () => {
  it('is zero for a fresh park', () => {
    expect(legacyPoints(ctx, 'u1')).toBe(0);
  });
  it('counts discovered species', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    recordSpeciesSeen(ctx, 'u1', 'velociraptor');
    expect(legacyPoints(ctx, 'u1')).toBe(2);
  });
  it('counts claimed achievement tiers', () => {
    ctx.db.insert(schema.achievementClaims).values([
      { userId: 'u1', trackId: 'eggs_hatched', tier: 0, claimedAt: 0 },
      { userId: 'u1', trackId: 'eggs_hatched', tier: 1, claimedAt: 0 },
    ]).run();
    expect(legacyPoints(ctx, 'u1')).toBe(2);
  });
  it('counts battle stars, not cleared stages', () => {
    ctx.db.insert(schema.battleProgress).values([
      { userId: 'u1', stageId: 'coastal_dig_1', stars: 3, firstClearedAt: 0 },
      { userId: 'u1', stageId: 'coastal_dig_2', stars: 2, firstClearedAt: 0 },
    ]).run();
    expect(legacyPoints(ctx, 'u1')).toBe(5);
  });
  it('is per user', () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(legacyPoints(ctx, 'u2')).toBe(0);
  });
});

describe('legacyRank', () => {
  // Species alone caps at allSpecies().length (52) and achievement claims cap at
  // ACHIEVEMENTS' 48 tiers — together exactly 100, which reaches Warden but neither
  // Conservator (140) nor Director (170). The brief's original threshold test seeded
  // points from species alone and skipped asserting on any threshold above the
  // then-42-species cap entirely, so three of the six tiers (Warden, Conservator,
  // Director) were NEVER exercised.
  // Seeding across all three point sources (species, achievement claims, battle stars —
  // the same three legacyPoints reads) reaches all 190 possible points, so every
  // threshold is reachable and gets an exact assertion below.
  const ALL_CLAIMS = ACHIEVEMENTS.flatMap((t) => t.tiers.map((_, tier) => ({ trackId: t.id, tier })));

  function seedPoints(c: ReturnType<typeof makeCtx>, n: number): void {
    let left = n;
    const speciesCount = Math.min(left, allSpecies().length);
    for (const s of allSpecies().slice(0, speciesCount)) recordSpeciesSeen(c, 'u1', s.id);
    left -= speciesCount;

    const claimCount = Math.min(left, ALL_CLAIMS.length);
    if (claimCount > 0) {
      c.db.insert(schema.achievementClaims).values(
        ALL_CLAIMS.slice(0, claimCount).map((cl) => ({ userId: 'u1', trackId: cl.trackId, tier: cl.tier, claimedAt: 0 })),
      ).run();
    }
    left -= claimCount;

    const starRows: { userId: string; stageId: string; stars: number; firstClearedAt: number }[] = [];
    let i = 0;
    while (left > 0) {
      const stars = Math.min(3, left);
      starRows.push({ userId: 'u1', stageId: `synthetic_${i++}`, stars, firstClearedAt: 0 });
      left -= stars;
    }
    if (starRows.length) c.db.insert(schema.battleProgress).values(starRows).run();
  }

  it('is null below the first threshold', () => {
    seedPoints(ctx, LEGACY_TIERS[0].points - 1);
    expect(legacyRank(ctx, 'u1')).toBeNull();
  });

  it('resolves each threshold exactly, and one point under it resolves to the tier beneath', () => {
    LEGACY_TIERS.forEach((tier, i) => {
      const below = makeCtx(); getOrCreateUser(below, 'u1', 'Reg');
      seedPoints(below, tier.points - 1);
      expect(legacyRank(below, 'u1'), `one point under ${tier.points}`)
        .toEqual(i === 0 ? null : LEGACY_TIERS[i - 1]);

      const at = makeCtx(); getOrCreateUser(at, 'u1', 'Reg');
      seedPoints(at, tier.points);
      expect(legacyRank(at, 'u1'), `exactly at ${tier.points}`).toEqual(tier);
    });
  });

  it('returns the HIGHEST tier reached, not the first, for a value between two thresholds', () => {
    // Halfway between Warden (100) and Conservator (140): a "find first satisfied
    // threshold ascending" bug would still return Groundskeeper (15) here, since
    // 15 <= 120 too — only keeping the LAST match in ascending iteration is correct.
    const between = makeCtx(); getOrCreateUser(between, 'u1', 'Reg');
    const warden = LEGACY_TIERS.find((t) => t.title === 'Warden')!;
    seedPoints(between, warden.points + 20);
    expect(legacyRank(between, 'u1')).toEqual(warden);
  });
});

describe('legacy rank persistence', () => {
  it('returns the stored best when the live total has dropped', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Curator is 65 points. Store that as the earned best, with no live points at all.
    ctx.db.update(schema.users).set({ legacyRankBest: 65 })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(legacyPoints(ctx, 'u1')).toBe(0);
    expect(legacyRank(ctx, 'u1')!.title).toBe('Curator');
  });

  it('prefers the live total when it exceeds the stored best', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ legacyRankBest: 15 })
      .where(eq(schema.users.discordId, 'u1')).run();
    for (const s of allSpecies().slice(0, 35)) recordSpeciesSeen(ctx, 'u1', s.id);
    // 35 live points beats a stored 15, so the live value wins.
    expect(legacyRank(ctx, 'u1')!.title).toBe('Keeper');
  });

  it('bumpLegacyBest latches the live total and never lowers it', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (const s of allSpecies().slice(0, 35)) recordSpeciesSeen(ctx, 'u1', s.id);
    bumpLegacyBest(ctx, 'u1');
    const after = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(after.legacyRankBest).toBe(35);

    // A later call with a LOWER live total must not move it down.
    ctx.db.delete(schema.speciesSeen).where(eq(schema.speciesSeen.userId, 'u1')).run();
    expect(legacyPoints(ctx, 'u1')).toBe(0);
    bumpLegacyBest(ctx, 'u1');
    const later = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(later.legacyRankBest).toBe(35);
  });
});
