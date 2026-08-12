export type TraitDomain = 'income' | 'care' | 'combat' | 'meta';

export type TraitId =
  | 'prolific' | 'runt' | 'grazer' | 'crowd_pleaser' | 'docile'
  | 'hardy' | 'thrifty' | 'skittish' | 'gluttonous' | 'voracious'
  | 'savage' | 'ironhide' | 'fleet' | 'glass_cannon' | 'frail'
  | 'prodigy' | 'fertile' | 'broody' | 'matriarch' | 'dull';

// Every field is a MULTIPLIER, default 1. `drain` scales the hunger drain RATE,
// so >1 empties faster; src/core/clock.ts divides the 48h window by it.
export interface TraitMods {
  income?: number; drain?: number; feed?: number;
  hp?: number; atk?: number; def?: number; spd?: number;
  xp?: number; breedTime?: number;
}

export interface TraitDef {
  id: TraitId;
  name: string;
  domain: TraitDomain;
  polarity: 'positive' | 'negative' | 'mixed';
  blurb: string;
  emoji: string;      // custom app-emoji name; resolved at RENDER time only
  fallback: string;   // unicode — the only form allowed in autocomplete labels
  mods: TraitMods;
}

// A dino can never hold two traits from one domain. That rule makes cancelling
// pairs (prolific + runt) impossible and gives /splice an unambiguous re-roll rule.
export const TRAITS: Record<TraitId, TraitDef> = {
  prolific:    { id: 'prolific',    name: 'Prolific',    domain: 'income', polarity: 'positive', blurb: '+15% income',                 emoji: 'dw_trait_income', fallback: '💰', mods: { income: 1.15 } },
  runt:        { id: 'runt',        name: 'Runt',        domain: 'income', polarity: 'negative', blurb: '-10% income',                 emoji: 'dw_trait_income', fallback: '💰', mods: { income: 0.90 } },
  grazer:      { id: 'grazer',      name: 'Grazer',      domain: 'income', polarity: 'mixed',    blurb: '+20% income, +20% hunger drain', emoji: 'dw_trait_income', fallback: '💰', mods: { income: 1.20, drain: 1.20 } },
  crowd_pleaser:{ id: 'crowd_pleaser',name: 'Crowd-Pleaser',domain: 'income', polarity: 'positive', blurb: '+25% income',                emoji: 'dw_trait_income', fallback: '💰', mods: { income: 1.25 } },
  docile:      { id: 'docile',      name: 'Docile',      domain: 'income', polarity: 'positive', blurb: '+10% income, -10% hunger drain', emoji: 'dw_trait_income', fallback: '💰', mods: { income: 1.10, drain: 0.90 } },

  hardy:       { id: 'hardy',       name: 'Hardy',       domain: 'care',   polarity: 'positive', blurb: '-25% hunger drain',           emoji: 'dw_trait_care',   fallback: '🌿', mods: { drain: 0.75 } },
  thrifty:     { id: 'thrifty',     name: 'Thrifty',     domain: 'care',   polarity: 'positive', blurb: '-25% feed cost',              emoji: 'dw_trait_care',   fallback: '🌿', mods: { feed: 0.75 } },
  skittish:    { id: 'skittish',    name: 'Skittish',    domain: 'care',   polarity: 'negative', blurb: '+20% hunger drain',           emoji: 'dw_trait_care',   fallback: '🌿', mods: { drain: 1.20 } },
  gluttonous:  { id: 'gluttonous',  name: 'Gluttonous',  domain: 'care',   polarity: 'negative', blurb: '+25% feed cost',              emoji: 'dw_trait_care',   fallback: '🌿', mods: { feed: 1.25 } },
  voracious:   { id: 'voracious',   name: 'Voracious',   domain: 'care',   polarity: 'mixed',    blurb: '-30% feed cost, +20% hunger drain', emoji: 'dw_trait_care',   fallback: '🌿', mods: { feed: 0.70, drain: 1.20 } },

  savage:      { id: 'savage',      name: 'Savage',      domain: 'combat', polarity: 'positive', blurb: '+12% attack',                 emoji: 'dw_trait_combat', fallback: '⚔️', mods: { atk: 1.12 } },
  ironhide:    { id: 'ironhide',    name: 'Ironhide',    domain: 'combat', polarity: 'positive', blurb: '+12% defence',                emoji: 'dw_trait_combat', fallback: '⚔️', mods: { def: 1.12 } },
  fleet:       { id: 'fleet',       name: 'Fleet',       domain: 'combat', polarity: 'positive', blurb: '+12% speed',                  emoji: 'dw_trait_combat', fallback: '⚔️', mods: { spd: 1.12 } },
  glass_cannon:{ id: 'glass_cannon',name: 'Glass Cannon',domain: 'combat', polarity: 'mixed',    blurb: '+25% attack, -15% HP',        emoji: 'dw_trait_combat', fallback: '⚔️', mods: { atk: 1.25, hp: 0.85 } },
  frail:       { id: 'frail',       name: 'Frail',       domain: 'combat', polarity: 'negative', blurb: '-10% HP',                     emoji: 'dw_trait_combat', fallback: '⚔️', mods: { hp: 0.90 } },

  prodigy:     { id: 'prodigy',     name: 'Prodigy',     domain: 'meta',   polarity: 'positive', blurb: '+20% battle XP',              emoji: 'dw_trait_meta',   fallback: '🧬', mods: { xp: 1.20 } },
  fertile:     { id: 'fertile',     name: 'Fertile',     domain: 'meta',   polarity: 'positive', blurb: '-25% breeding time',          emoji: 'dw_trait_meta',   fallback: '🧬', mods: { breedTime: 0.75 } },
  broody:      { id: 'broody',      name: 'Broody',      domain: 'meta',   polarity: 'positive', blurb: '-40% breeding time',          emoji: 'dw_trait_meta',   fallback: '🧬', mods: { breedTime: 0.60 } },
  matriarch:   { id: 'matriarch',   name: 'Matriarch',   domain: 'meta',   polarity: 'mixed',    blurb: '-30% breeding time, -10% income', emoji: 'dw_trait_meta',   fallback: '🧬', mods: { breedTime: 0.70, income: 0.90 } },
  dull:        { id: 'dull',        name: 'Dull',        domain: 'meta',   polarity: 'negative', blurb: '-15% battle XP',              emoji: 'dw_trait_meta',   fallback: '🧬', mods: { xp: 0.85 } },
};

export const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

export function getTrait(id: string): TraitDef {
  const t = (TRAITS as Record<string, TraitDef | undefined>)[id];
  if (!t) throw new Error(`Unknown trait: ${id}`);
  return t;
}

// Tolerant by design: trait ids are persisted in a JSON column, so a trait
// removed from the table in a later release must not crash every read path.
export function traitDefs(ids: string[]): TraitDef[] {
  return ids.map((id) => (TRAITS as Record<string, TraitDef | undefined>)[id]).filter((t): t is TraitDef => t !== undefined);
}

/** Product of one modifier across a dino's traits. The single accessor every consumer uses. */
export function modProduct(ids: string[], key: keyof TraitMods): number {
  return traitDefs(ids).reduce((acc, t) => acc * (t.mods[key] ?? 1), 1);
}

// Index = slot count. Bred eggs beat a wild hatch — that gap IS the reason to breed.
export const WILD_SLOT_ODDS = [0.55, 0.35, 0.10] as const;
export const BRED_SLOT_ODDS = [0.25, 0.45, 0.30] as const;

// Exported so inheritTraits (src/modules/genelab/service.ts) rolls its bred-odds
// slot count through the same implementation rather than a second copy of this loop.
export function rollSlotCount(odds: readonly number[], rng: () => number): number {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < odds.length; i++) {
    acc += odds[i];
    if (r < acc) return i;
  }
  return odds.length - 1;
}

export function pickTrait(rng: () => number, exclude: Set<TraitDomain>): TraitId | null {
  const pool = TRAIT_IDS.filter((id) => !exclude.has(TRAITS[id].domain));
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}

export function rollTraits(rng: () => number, odds: readonly number[] = WILD_SLOT_ODDS): TraitId[] {
  const count = rollSlotCount(odds, rng);
  const out: TraitId[] = [];
  const used = new Set<TraitDomain>();
  for (let i = 0; i < count; i++) {
    const picked = pickTrait(rng, used);
    if (!picked) break;
    out.push(picked);
    used.add(TRAITS[picked].domain);
  }
  return out;
}

/**
 * Re-roll one slot. On a dino with no traits, slot 0 ADDS one. The replacement
 * draws from any domain the surviving slot is not using, so the domain rule
 * holds without the caller checking anything.
 */
export function spliceTrait(current: string[], slot: number, rng: () => number): TraitId[] {
  if (slot < 0 || slot > Math.min(current.length, 1)) {
    throw new Error(`Invalid splice slot ${slot}`);
  }
  const surviving = current.filter((_, idx) => idx !== slot);
  const exclude = new Set(traitDefs(surviving).map((t) => t.domain));
  const picked = pickTrait(rng, exclude);
  const out = [...current] as TraitId[];
  if (!picked) return out;
  if (slot < current.length) out[slot] = picked;
  else out.push(picked);
  return out;
}
