import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CAMPAIGN, STAGES, stageUnlocked, chapterUnlocked, rosterFor, type ProgressMap,
} from '../src/data/battle/chapters/index.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';
import { getSpecies } from '../src/data/species/index.js';
import { getFood } from '../src/data/foods.js';

// NPCs may exceed the player LEVEL_CAP (10) — bosses are meant to outlevel
// you — but never past this sanity ceiling.
const NPC_LEVEL_SANITY_CAP = 12;

describe('battle campaign content', () => {
  it('chapter ids are EXPEDITION_SITES keys in unlockRating order', () => {
    expect(CAMPAIGN.map((c) => c.id)).toEqual(['coastal_dig', 'amber_ridge', 'frozen_cliffs', 'volcano_core']);
    for (const c of CAMPAIGN) expect(EXPEDITION_SITES[c.id]).toBeDefined();
    const ratings = CAMPAIGN.map((c) => EXPEDITION_SITES[c.id].unlockRating);
    for (let i = 1; i < ratings.length; i++) expect(ratings[i]).toBeGreaterThan(ratings[i - 1]);
  });

  it('has 5 stages per chapter, ids unique and prefix-correct, exactly one boss and it is last', () => {
    const seen = new Set<string>();
    for (const c of CAMPAIGN) {
      expect(c.stages).toHaveLength(5);
      c.stages.forEach((s, i) => {
        const expectedId = i === c.stages.length - 1 ? `${c.id}_boss` : `${c.id}_${i + 1}`;
        expect(s.id).toBe(expectedId);
        expect(seen.has(s.id)).toBe(false);
        seen.add(s.id);
        if (i === c.stages.length - 1) expect(s.boss).toBeDefined();
        else expect(s.boss).toBeUndefined();
      });
    }
    expect(seen.size).toBe(20);
    expect(STAGES.size).toBe(20);
    for (const c of CAMPAIGN) for (const s of c.stages) expect(STAGES.get(s.id)?.chapterId).toBe(c.id);
  });

  it('every speciesId, eggSpeciesId, and foodId resolves against the real registries', () => {
    for (const c of CAMPAIGN) {
      for (const s of c.stages) {
        expect(s.enemies).toHaveLength(3);
        for (const e of s.enemies) expect(() => getSpecies(e.speciesId)).not.toThrow();
        const food = s.rewards.food;
        if (food) {
          expect(() => getFood(food.foodId)).not.toThrow();
          expect(food.qty).toBeGreaterThan(0);
        }
        const boss = s.boss;
        if (boss) {
          expect(() => getSpecies(boss.speciesId)).not.toThrow();
          const eggSpeciesId = boss.eggSpeciesId;
          if (eggSpeciesId !== null) {
            expect(() => getSpecies(eggSpeciesId)).not.toThrow();
            // hatchEgg pins this species directly, so its rarity IS the egg's real rarity —
            // a mismatch would mint value the displayed rarity never promised.
            expect(getSpecies(eggSpeciesId).rarity).toBe(boss.eggRarity);
          }
        }
      }
    }
  });

  it('energyCost is 1..3 and every boss stage costs exactly 3', () => {
    for (const c of CAMPAIGN) {
      for (const s of c.stages) {
        expect(s.energyCost).toBeGreaterThanOrEqual(1);
        expect(s.energyCost).toBeLessThanOrEqual(3);
        if (s.boss) expect(s.energyCost).toBe(3);
      }
    }
  });

  it('npcLevel >= 1 everywhere; boss npcLevel + levelBonus within the sanity cap', () => {
    for (const c of CAMPAIGN) {
      for (const s of c.stages) {
        expect(s.npcLevel).toBeGreaterThanOrEqual(1);
        expect(s.npcLevel).toBeLessThanOrEqual(NPC_LEVEL_SANITY_CAP);
        if (s.boss) {
          expect(s.boss.levelBonus).toBeGreaterThanOrEqual(1);
          expect(s.npcLevel + s.boss.levelBonus).toBeLessThanOrEqual(NPC_LEVEL_SANITY_CAP);
        }
      }
    }
  });

  it('cash, xp, and firstClearShards are monotonically nondecreasing per stage position across chapters', () => {
    for (let pos = 0; pos < 5; pos++) {
      for (const key of ['cash', 'xp'] as const) {
        const vals = CAMPAIGN.map((c) => c.stages[pos].rewards[key]);
        for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
      }
      const shards = CAMPAIGN.map((c) => c.stages[pos].firstClearShards);
      for (let i = 1; i < shards.length; i++) expect(shards[i]).toBeGreaterThanOrEqual(shards[i - 1]);
    }
  });

  it('total campaign first-clear shards stay far below the 500-shard mythic price', () => {
    const total = CAMPAIGN.flatMap((c) => c.stages).reduce((sum, s) => sum + s.firstClearShards, 0);
    expect(total).toBe(93);          // pinned — retune deliberately, never by accident
    expect(total).toBeLessThan(500); // margin today: 407
  });

  it('boss eggs ramp rare -> epic -> legendary -> legendary with pinned bossIds, no mythic', () => {
    const bosses = CAMPAIGN.map((c) => c.stages[4].boss!);
    expect(bosses.map((b) => b.eggRarity)).toEqual(['rare', 'epic', 'legendary', 'legendary']);
    expect(bosses.map((b) => b.bossId)).toEqual([
      'boss-coastal_dig', 'boss-amber_ridge', 'boss-frozen_cliffs', 'boss-volcano_core',
    ]);
    expect(bosses.slice(0, 3).map((b) => b.eggSpeciesId)).toEqual([null, null, null]);
    expect(bosses[3].eggSpeciesId).toBe('tyrannosaurus');
    for (const b of bosses) expect(b.eggRarity).not.toBe('mythic');
  });

  it('boss is authored as the third enemy (enemies[2]) on every boss stage', () => {
    // rosterFor's small-squad branch (src/data/battle/chapters/index.ts) always
    // returns stage.enemies[2] as the boss for squadSize < 3, with no runtime
    // check. This is the invariant that assumption depends on: violate it in a
    // future chapter and rosterFor silently fields a non-boss enemy for any
    // squad smaller than 3 — the exact "embed lies about who fought" bug
    // rosterFor exists to prevent.
    for (const c of CAMPAIGN) {
      const bossStage = c.stages[4];
      const boss = bossStage.boss!;
      expect(
        bossStage.enemies[2].speciesId,
        `${bossStage.id}: the boss (${boss.speciesId}) must be authored as ` +
          `enemies[2] (the third enemy), not '${bossStage.enemies[2].speciesId}' — ` +
          `rosterFor's small-squad branch reads stage.enemies[2] as the boss unconditionally.`,
      ).toBe(boss.speciesId);
    }
  });

  it('every bossId has a matching entry in docs/assets/prompts.md', () => {
    const prompts = readFileSync(new URL('../docs/assets/prompts.md', import.meta.url), 'utf8');
    for (const c of CAMPAIGN) expect(prompts).toContain(c.stages[4].boss!.bossId);
  });
});

describe('battle gating', () => {
  const prog = (entries: Record<string, { stars: number; firstClearedAt: number | null }>): ProgressMap =>
    new Map(Object.entries(entries));

  it('stage 1 of any chapter is always stage-unlocked (chapter gate is separate)', () => {
    expect(stageUnlocked('coastal_dig_1', prog({}))).toBe(true);
    expect(stageUnlocked('volcano_core_1', prog({}))).toBe(true);
  });

  it('later stages require >=1 star on the previous stage', () => {
    expect(stageUnlocked('coastal_dig_2', prog({}))).toBe(false);
    expect(stageUnlocked('coastal_dig_2', prog({ coastal_dig_1: { stars: 0, firstClearedAt: null } }))).toBe(false);
    expect(stageUnlocked('coastal_dig_2', prog({ coastal_dig_1: { stars: 1, firstClearedAt: 5 } }))).toBe(true);
    expect(stageUnlocked('coastal_dig_boss', prog({ coastal_dig_4: { stars: 3, firstClearedAt: 5 } }))).toBe(true);
    expect(stageUnlocked('coastal_dig_boss', prog({ coastal_dig_3: { stars: 3, firstClearedAt: 5 } }))).toBe(false);
  });

  it('unknown stage is never unlocked', () => {
    expect(stageUnlocked('coastal_dig_9', prog({}))).toBe(false);
  });

  it('chapter 1 is open to everyone', () => {
    expect(chapterUnlocked('coastal_dig', prog({}), 0)).toBe(true);
  });

  it('later chapters require prior boss first-clear AND the site unlockRating high-water', () => {
    const bossCleared = prog({ coastal_dig_boss: { stars: 1, firstClearedAt: 1_000 } });
    expect(chapterUnlocked('amber_ridge', prog({}), 999)).toBe(false);    // rating alone is not enough
    expect(chapterUnlocked('amber_ridge', bossCleared, 299)).toBe(false); // boss clear alone is not enough
    expect(chapterUnlocked('amber_ridge', bossCleared, 300)).toBe(true);  // both gates satisfied
  });

  it('a boss row with stars but no firstClearedAt does not unlock the next chapter', () => {
    expect(chapterUnlocked('amber_ridge', prog({ coastal_dig_boss: { stars: 2, firstClearedAt: null } }), 400)).toBe(false);
  });

  it('unknown chapter is never unlocked', () => {
    expect(chapterUnlocked('sky_temple', prog({}), 9_999)).toBe(false);
  });
});

describe('rosterFor', () => {
  const bossStage = STAGES.get('coastal_dig_boss')!;
  const normalStage = STAGES.get('coastal_dig_1')!;

  // Boss identification (the `boss` flag) is asserted alongside selection in
  // every boss-stage case below: rosterFor is the single source of truth for
  // BOTH "who fought" and "which one was the boss" (Task 9's service and
  // Task 10's embeds both read the flag rather than re-deriving it).
  it('boss stage, squadSize 3: all three authored enemies in authored order, boss flagged on exactly one', () => {
    const roster = rosterFor(bossStage, 3);
    expect(roster).toHaveLength(3);
    expect(roster.map((e) => e.speciesId)).toEqual(bossStage.enemies.map((e) => e.speciesId));
    expect(roster.filter((e) => e.boss !== undefined)).toHaveLength(1);
    expect(roster[2].boss).toEqual(bossStage.boss);
    expect(roster[0].boss).toBeUndefined();
    expect(roster[1].boss).toBeUndefined();
  });

  it('boss stage, squadSize 2: first authored enemy + boss entry, boss flagged on exactly one', () => {
    const roster = rosterFor(bossStage, 2);
    expect(roster).toHaveLength(2);
    expect(roster.map((e) => e.speciesId)).toEqual([bossStage.enemies[0].speciesId, bossStage.enemies[2].speciesId]);
    expect(roster.filter((e) => e.boss !== undefined)).toHaveLength(1);
    expect(roster[1].boss).toEqual(bossStage.boss);
    expect(roster[0].boss).toBeUndefined();
  });

  it('boss stage, squadSize 1: just the boss entry, flagged', () => {
    const roster = rosterFor(bossStage, 1);
    expect(roster).toHaveLength(1);
    expect(roster[0].speciesId).toBe(bossStage.enemies[2].speciesId);
    expect(roster[0].boss).toEqual(bossStage.boss);
  });

  it('normal stage: plain first-N slice for squad sizes 1, 2, and 3, boss flag never set', () => {
    expect(rosterFor(normalStage, 1).map((e) => e.speciesId)).toEqual([normalStage.enemies[0].speciesId]);
    expect(rosterFor(normalStage, 2).map((e) => e.speciesId)).toEqual(normalStage.enemies.slice(0, 2).map((e) => e.speciesId));
    expect(rosterFor(normalStage, 3).map((e) => e.speciesId)).toEqual(normalStage.enemies.slice(0, 3).map((e) => e.speciesId));
    for (const size of [1, 2, 3]) {
      expect(rosterFor(normalStage, size).every((e) => e.boss === undefined)).toBe(true);
    }
  });
});
