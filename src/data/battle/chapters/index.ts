import type { Rarity } from '../../types.js';
import type { FoodId } from '../../foods.js';
import { EXPEDITION_SITES } from '../../sites.js';
import { siteUnlocked } from '../../progression.js';
import { coastalDig } from './coastal_dig.js';
import { amberRidge } from './amber_ridge.js';
import { frozenCliffs } from './frozen_cliffs.js';
import { volcanoCore } from './volcano_core.js';

export interface BossDef {
  bossId: string;        // derives assets/images/battles/<bossId>-portrait.png
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
// banner asset, the unlockRating co-gate, and the theme.
export interface ChapterDef { id: string; name: string; tagline: string; stages: StageDef[] }

export const CAMPAIGN: ChapterDef[] = [coastalDig, amberRidge, frozenCliffs, volcanoCore];

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
  const prior = CAMPAIGN[idx - 1];
  const priorBoss = prior.stages[prior.stages.length - 1];
  if ((progress.get(priorBoss.id)?.firstClearedAt ?? null) === null) return false;
  return siteUnlocked(EXPEDITION_SITES[chapterId].unlockRating, ratingHighWater);
}

// Single source of truth for enemy-roster selection, shared by Task 9's
// service and Task 10's embeds so both always agree on who actually fought.
// Boss stages always field the boss (authored last, index 2); normal stages
// take the first N of the weakest-first roster.
export function rosterFor(stage: StageDef, squadSize: number): { speciesId: string }[] {
  if (stage.boss) {
    if (squadSize >= 3) return [...stage.enemies];
    return [...stage.enemies.slice(0, squadSize - 1), stage.enemies[2]];
  }
  return stage.enemies.slice(0, squadSize);
}
