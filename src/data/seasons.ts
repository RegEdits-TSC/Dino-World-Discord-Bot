import type { StatId } from '../core/stats.js';
import type { FoodId } from './foods.js';

/**
 * One point source. `points` per `per` units of the stat, floored, summed across the
 * source's stats, then clamped to `cap`.
 *
 * The cap is the whole design: it converts an unbounded grind into early saturation
 * rather than a treadmill, which is what lets a source with no real-time gate
 * (dinos_fed, shop_purchases) sit in the ladder at all.
 */
export interface SeasonSource {
  id: string;
  name: string;
  stats: ReadonlyArray<{ stat: StatId; points: number; per: number }>;
  cap: number;
}

/**
 * Nine sources, 1,335 available against an 800 capstone. No source reaches 32% of the
 * capstone, so breadth is forced without any single source being mandatory.
 *
 * Deliberately excluded: stages_first_cleared / lots_built / lots_upgraded (finite
 * lifetime counters a veteran can never move again — crediting them favours new
 * accounts over exactly the players this loop exists to keep); dinos_rescued (an
 * artifact of neglect, so paying for it rewards letting dinos escape);
 * eggs_incubated (shares one ceiling with eggs_hatched, so crediting both double-pays
 * a single action, the thing CHURN_STATS already prevents on quest boards);
 * breedings_started (claimed <= started always, same double-pay); income_collected
 * (36,036/day mid-game against 4,561,920/day endgame — a 126x spread no single rate
 * calibrates for both ends).
 */
export const SEASON_SOURCES: readonly SeasonSource[] = [
  // Priced against the energy ceiling: ENERGY_CAP 10 + a 10-minute regen = 144 fights/day.
  // battles_fought rather than battles_won so an under-geared squad is never shut out.
  { id: 'campaign', name: 'Campaign', stats: [{ stat: 'battles_fought', points: 1, per: 4 }], cap: 250 },
  // Single expedition slot; sites run 15 min to 48 h. The high per-unit value protects the
  // player running long sites for egg odds from being punished into short-site spam.
  { id: 'expeditions', name: 'Expeditions', stats: [{ stat: 'expeditions_claimed', points: 5, per: 1 }], cap: 250 },
  { id: 'hatchery', name: 'Hatchery', stats: [{ stat: 'eggs_hatched', points: 3, per: 1 }], cap: 225 },
  { id: 'genelab', name: 'Gene Lab', stats: [{ stat: 'breedings_claimed', points: 5, per: 1 }], cap: 180 },
  // The worst rate in the ladder, deliberately: tier-1 food fills to exactly 100 and
  // hungerAt drops below it after any dt > 0, so a dino re-qualifies almost immediately
  // and a 48-dino roster banks this whole cap in ~8 interactions. The cap contains it —
  // the exploit buys days, never points.
  { id: 'care', name: 'Dino care', stats: [{ stat: 'dinos_fed', points: 1, per: 3 }], cap: 120 },
  { id: 'sales', name: 'Sales', stats: [{ stat: 'dinos_sold', points: 3, per: 1 }], cap: 100 },
  // 15 points, not 6. At 6 the cap took 15 splices = 225 shards to earn 90 points against
  // the 110 the whole track pays back — net-negative in the scarce currency for exactly
  // the shard-poor players these 90 points are sized for. At 15 the cap costs 6 splices,
  // 90 shards, under what the track returns.
  { id: 'splicing', name: 'Splicing', stats: [{ stat: 'splices_done', points: 15, per: 1 }], cap: 90 },
  // Two honest routes to one cap: 4 trades or 60 shop transactions. trades_completed
  // cannot stand alone (acceptTrade requires a second player and only the recipient may
  // accept), and dropping it would mean the social loop earns nothing on the track.
  // shop_purchases increments once per TRANSACTION, never per unit.
  { id: 'commerce', name: 'Commerce', stats: [
    { stat: 'trades_completed', points: 15, per: 1 },
    { stat: 'shop_purchases', points: 1, per: 1 },
  ], cap: 60 },
  // A participation floor, not a challenge: collecting requires only amount > 0.
  { id: 'collections', name: 'Park collections', stats: [{ stat: 'income_collections', points: 1, per: 1 }], cap: 60 },
];

export interface SeasonRung {
  points: number;
  rewards: {
    cash?: number; shards?: number;
    food?: { foodId: FoodId; qty: number };
    eggRarity?: 'rare' | 'epic';
  };
}

/**
 * Eight rungs. The moderate profile scores 37.3 points/day, clearing the capstone on day
 * 21.4 with 8.6 days of slack; a 10-day lapsed player reaches 373 and lands on rung 4.
 *
 * Totals: 60,000 cash (1.32x a month of daily quests) and 110 shards (24% of the quest
 * shard line). Cash high, shards low, on purpose.
 *
 * The BADGE IS NOT HERE. Crossing SEASON_CAPSTONE grants it outright — rung 8 pays only
 * its cash and shards and forfeits like any other rung.
 */
export const SEASON_RUNGS: readonly SeasonRung[] = [
  { points: 50, rewards: { cash: 3_000 } },
  { points: 125, rewards: { cash: 6_000, food: { foodId: 'royal_greens', qty: 20 } } },
  { points: 225, rewards: { cash: 8_000, shards: 15 } },          // exactly one splice
  { points: 350, rewards: { cash: 10_000, eggRarity: 'rare' } },  // mirrors chestFor's streak-14
  { points: 475, rewards: { cash: 12_000, shards: 25 } },
  { points: 600, rewards: { cash: 12_000, food: { foodId: 'prime_steak', qty: 40 } } },
  { points: 700, rewards: { shards: 30, eggRarity: 'epic' } },    // matches chestFor's 30-day epic
  { points: 800, rewards: { cash: 9_000, shards: 40 } },
];

export const SEASON_CAPSTONE = SEASON_RUNGS[SEASON_RUNGS.length - 1].points;

/** Belt-and-braces above the natural 197 maximum (52 species + 105 stars + 40 rating). */
export const HEAD_START_CAP = 200;

/** Integer math only — floor per unit, sum across stats, clamp at the cap. */
export function sourcePoints(src: SeasonSource, deltas: Partial<Record<StatId, number>>): number {
  let raw = 0;
  for (const e of src.stats) {
    const d = Math.max(0, deltas[e.stat] ?? 0);
    raw += Math.floor(d / e.per) * e.points;
  }
  return Math.min(src.cap, raw);
}
