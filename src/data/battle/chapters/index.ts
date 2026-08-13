import type { Rarity } from '../../types.js';
import type { FoodId } from '../../foods.js';
import { EXPEDITION_SITES } from '../../sites.js';
import { siteUnlocked } from '../../progression.js';
import { coastalDig } from './coastal_dig.js';
import { amberRidge } from './amber_ridge.js';
import { frozenCliffs } from './frozen_cliffs.js';
import { volcanoCore } from './volcano_core.js';
import { abyssalTrench } from './abyssal_trench.js';
import { containmentSite } from './containment_site.js';
import { foundersPark } from './founders_park.js';

export interface BossDef {
  bossId: string;        // derives assets/images/battles/<bossId>-portrait.webp
  title: string;
  speciesId: string;
  levelBonus: number;
  hpMult: number;
  atkMult: number;
  eggRarity: Rarity;
  eggSpeciesId: string | null;  // pinned trophy species, or null = roll at hatch
}

export interface StageDef {
  id: string;            // `${chapterId}_${n}` or `${chapterId}_boss`
  name: string;
  energyCost: 1 | 2 | 3;
  npcLevel: number;
  enemies: [{ speciesId: string }, { speciesId: string }, { speciesId: string }]; // weakest-first
  rewards: { cash: number; food?: { foodId: FoodId; qty: number }; xp: number };  // 1-star base
  firstClearShards: number;
  boss?: BossDef;
}

// id MUST equal an EXPEDITION_SITES key — this single invariant derives the
// banner asset and the theme, and (for every chapter that does NOT set
// starGate) the unlockRating co-gate as well.
export interface ChapterDef {
  id: string; name: string; tagline: string; stages: StageDef[];
  // Absolute campaign-star total. When set, it REPLACES the site's unlockRating
  // co-gate for this chapter — see chapterUnlocked. Deliberately absolute and
  // never a fraction of the campaign total: a fraction would silently re-tighten
  // on existing players every time a chapter ships.
  starGate?: number;
}

export const CAMPAIGN: ChapterDef[] = [coastalDig, amberRidge, frozenCliffs, volcanoCore, abyssalTrench, containmentSite, foundersPark];

export const STAGES = new Map<string, StageDef & { chapterId: string }>(
  CAMPAIGN.flatMap((ch) => ch.stages.map((st) => [st.id, { ...st, chapterId: ch.id }] as const)),
);

export type ProgressMap = Map<string, { stars: number; firstClearedAt: number | null }>;

// Stage 1 of a chapter is always stage-unlocked; the chapter gate is
// chapterUnlocked's job — callers AND the two together.
export function stageUnlocked(stageId: string, progress: ProgressMap): boolean {
  const stage = STAGES.get(stageId);
  if (!stage) return false;
  const chapter = CAMPAIGN.find((c) => c.id === stage.chapterId)!;
  const idx = chapter.stages.findIndex((s) => s.id === stageId);
  if (idx === 0) return true;
  return (progress.get(chapter.stages[idx - 1].id)?.stars ?? 0) >= 1;
}

export function chapterUnlocked(chapterId: string, progress: ProgressMap, ratingHighWater: number): boolean {
  const idx = CAMPAIGN.findIndex((c) => c.id === chapterId);
  if (idx < 0) return false;
  if (idx === 0) return true;
  const chapter = CAMPAIGN[idx];
  const prior = CAMPAIGN[idx - 1];
  const priorBoss = prior.stages[prior.stages.length - 1];
  if ((progress.get(priorBoss.id)?.firstClearedAt ?? null) === null) return false;
  // Two gate kinds. A star gate is used where a rating gate would be gameable:
  // recomputeRating's comfort term averages over ASSIGNED dinos only, so
  // unassigning all but one well-kept dino sets that quarter to 1.0 at will.
  // Stars cannot be shuffled — they are earned per stage and monotone.
  // Summing the whole progress map is safe: a chapter's own stages are
  // unreachable until it unlocks, so "all stars" and "stars before this
  // chapter" are the same number at the moment this is evaluated.
  if (chapter.starGate != null) {
    const stars = [...progress.values()].reduce((sum, p) => sum + p.stars, 0);
    return stars >= chapter.starGate;
  }
  return siteUnlocked(EXPEDITION_SITES[chapterId].unlockRating, ratingHighWater);
}

// Single source of truth for enemy-roster selection, shared by Task 9's
// service and Task 10's embeds so both always agree on who actually fought.
// Boss stages always field the boss (authored last, index 2); normal stages
// take the first N of the weakest-first roster.
//
// Boss identification also lives here, not in the caller: the boss entry is
// always the LAST element of a boss stage's roster (authored as enemies[2],
// pinned by tests/battle-content.test.ts's "boss is authored as the third
// enemy" test, and never sliced out because the small-squad branch above
// always keeps enemies[2]). A caller re-deriving "is this the boss" by
// matching speciesId would silently double-boss any future roster that
// reuses the boss's species as ordinary filler elsewhere in enemies[0..1].
export function rosterFor(stage: StageDef, squadSize: number): { speciesId: string; boss?: BossDef }[] {
  if (!stage.boss) return stage.enemies.slice(0, squadSize).map((e) => ({ ...e }));
  const entries = squadSize >= 3
    ? [...stage.enemies]
    : [...stage.enemies.slice(0, squadSize - 1), stage.enemies[2]];
  const boss = stage.boss;
  return entries.map((e, i) => (i === entries.length - 1 ? { ...e, boss } : { ...e }));
}
