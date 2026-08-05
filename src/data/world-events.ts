// The world is DERIVED, never stored — same philosophy as escrow locks
// (src/core/locks.ts) and quest progress (src/modules/daily/service.ts).
// This file is data only; the derivation lives in src/core/world.ts.

export type WorldEventId =
  | 'clear_skies' | 'amber_storm' | 'fossil_rush' | 'heat_wave' | 'cold_snap'
  | 'bumper_harvest' | 'market_panic' | 'blood_moon' | 'migration_season';

/**
 * Every modifier an event can apply. All are multipliers except
 * `expeditionOddsShift` (a ladder step) and `energyCostDelta` (an addend).
 *
 * `income` is the ONLY field integrated over time. Never read it off a
 * request-time record to compute a payout — sample it per segment via
 * `incomeMultAt(t)`. It lives here so /world and the header lines can show it.
 */
export interface EventMods {
  income: number;
  feedCost: number;
  expeditionMs: number;
  expeditionFee: number;
  expeditionCash: number;
  expeditionOddsShift: -1 | 0 | 1;
  eggPrice: number;
  foodPrice: number;
  sellCash: number;
  energyCostDelta: number;
  battleXp: number;
  enemyHp: number;
  breedMs: number;
  /** [0-trait, 1-trait, 2-trait] fractions summing to 1 — the same convention
   *  as WILD_SLOT_ODDS/BRED_SLOT_ODDS (src/data/traits.ts), fed straight into
   *  rollTraits/rollSlotCount with no normalization. Never a 0-100 scale. */
  hatchTraitOdds: [number, number, number] | null;
}

export const NEUTRAL_MODS: EventMods = {
  income: 1, feedCost: 1, expeditionMs: 1, expeditionFee: 1, expeditionCash: 1,
  expeditionOddsShift: 0, eggPrice: 1, foodPrice: 1, sellCash: 1,
  energyCostDelta: 0, battleXp: 1, enemyHp: 1, breedMs: 1, hatchTraitOdds: null,
};

export interface WorldEvent {
  id: WorldEventId;
  name: string;
  /** The custom emoji NAME. Resolved through emojiTag() at RENDER time —
   *  never in a module-level constant, or the unicode fallback freezes. */
  emoji: string;
  blurb: string;
  weight: number;
  mods: Partial<EventMods>;
  /** Player-facing effect lines, plain language, no raw multipliers. */
  effects: string[];
}

// Clear Skies carries weight 4 against eight events at weight 1 (total 12), so
// one day in three is uneventful. An event every day is not an event.
// ORDER IS LOAD-BEARING: rollWeighted walks this array, so reordering it
// changes which event every historical day resolved to. See WORLD_SALT.
export const WORLD_EVENTS: WorldEvent[] = [
  {
    id: 'clear_skies', name: 'Clear Skies', emoji: 'dw_event_clear_skies', weight: 4,
    blurb: 'A calm day across the islands. Nothing unusual on the wind.',
    mods: {},
    effects: [],
  },
  {
    id: 'amber_storm', name: 'Amber Storm', emoji: 'dw_event_amber_storm', weight: 1,
    blurb: 'Resin-laden squalls scour the dig sites. The digging is fast and the hazard pay is worse.',
    mods: { expeditionMs: 0.75, expeditionFee: 2 },
    effects: ['Expeditions finish 25% sooner', 'Expedition fees are doubled'],
  },
  {
    id: 'fossil_rush', name: 'Fossil Rush', emoji: 'dw_event_fossil_rush', weight: 1,
    blurb: 'A collapsed shelf has opened a bone bed. Everyone is digging; nobody is being careful.',
    mods: { expeditionCash: 1.5, expeditionOddsShift: -1 },
    effects: ['Expeditions pay 50% more cash', 'Expedition eggs come back one rarity step worse'],
  },
  {
    id: 'heat_wave', name: 'Heat Wave', emoji: 'dw_event_heat_wave', weight: 1,
    blurb: 'The basin bakes. Visitors crowd the shaded enclosures and your herds eat through the pantry.',
    mods: { income: 1.2, feedCost: 1.3 },
    effects: ['Park income +20%', 'Feeding costs 30% more food'],
  },
  {
    id: 'cold_snap', name: 'Cold Snap', emoji: 'dw_event_cold_snap', weight: 1,
    blurb: 'A hard frost settles in. The animals are sluggish, and so is the turnstile.',
    mods: { income: 0.9, feedCost: 0.75 },
    effects: ['Feeding costs 25% less food', 'Park income −10%'],
  },
  {
    id: 'bumper_harvest', name: 'Bumper Harvest', emoji: 'dw_event_bumper_harvest', weight: 1,
    blurb: 'The mainland greenhouses overproduced. Feed is cheap and everything else is not.',
    mods: { foodPrice: 0.6, eggPrice: 1.25 },
    effects: ['Food costs 40% less', 'Eggs cost 25% more'],
  },
  {
    id: 'market_panic', name: 'Market Panic', emoji: 'dw_event_market_panic', weight: 1,
    blurb: 'A rival park folded overnight. Stock is flooding the market and nobody is buying.',
    mods: { eggPrice: 0.7, sellCash: 0.8 },
    effects: ['Eggs cost 30% less', 'Selling a dino pays 20% less cash'],
  },
  {
    id: 'blood_moon', name: 'Blood Moon', emoji: 'dw_event_blood_moon', weight: 1,
    blurb: 'Something has the carnivores agitated. They are hunting, and they are harder to put down.',
    mods: { energyCostDelta: -1, battleXp: 1.5, enemyHp: 1.15 },
    effects: ['Every stage costs 1 less energy (minimum 1)', 'Battle XP ×1.5', 'Enemies have 15% more HP'],
  },
  {
    id: 'migration_season', name: 'Migration Season', emoji: 'dw_event_migration_season', weight: 1,
    blurb: 'Wild bloodlines are on the move. Fresh hatchlings are strange; the labs are distracted.',
    // Fractions summing to 1, the same convention as WILD_SLOT_ODDS/BRED_SLOT_ODDS
    // (src/data/traits.ts) — rollSlotCount compares them straight against rng(),
    // with no normalization. [45, 40, 15] here would put 100% of the mass under
    // the first cumulative step (45 > any draw in [0,1)) and roll zero traits
    // on every single Migration Season hatch — the opposite of the intended buff.
    mods: { hatchTraitOdds: [0.45, 0.40, 0.15], breedMs: 1.25 },
    effects: ['Wild hatches roll far better traits', 'Breeding takes 25% longer'],
  },
];
