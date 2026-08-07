import { mulberry32, rollWeighted } from './rolls.js';
import { WORLD_EVENTS, NEUTRAL_MODS, type WorldEvent, type EventMods } from '../data/world-events.js';

// DAY_MS is duplicated from src/core/clock.ts DELIBERATELY. clock.ts imports
// incomeMultAt from THIS module, so importing DAY_MS back would create the
// repo's first core↔core cycle — and under ESM NodeNext a module-level const
// computed from a cyclic import hits the temporal dead zone and throws a
// ReferenceError at import time, depending on which module is entered first.
// One duplicated integer is cheaper than that failure mode.
const DAY_MS = 86_400_000;

// Chosen so UTC days 0-4 all resolve to Clear Skies (all-neutral modifiers).
// This is a TEST-ENVIRONMENT decision with zero production impact: makeCtx
// defaults nowMs to 0 (tests/harness.ts:17), so essentially the whole existing
// OFFLINE suite runs on day 0, and an eventful epoch would silently multiply
// pinned fixtures across a dozen test files. scripts/test-live.ts is the one
// exception — it calls ctx.setNow(Date.now()), real wall time, deliberately,
// so its gallery reflects whatever event is live today rather than day 0.
// Real players are past day 20,000. Long-run Clear Skies share is 0.3338 over
// 1,000,000 days against the 1/3 design target.
//
// The salt is also what keeps the world stream independent of the shop's:
// dailyEggOffers seeds mulberry32(day) RAW (src/modules/shop/service.ts:19), so
// an unsalted world would permanently correlate "Market Panic day" with a fixed
// shop rotation. Both properties are pinned by tests/world.test.ts — if you
// change this constant or reorder WORLD_EVENTS, re-run that search.
const WORLD_SALT = 0x2c0;

export function dayIndex(now: number): number {
  return Math.floor(now / DAY_MS);
}

export function worldEventFor(now: number): WorldEvent {
  return rollWeighted(
    WORLD_EVENTS.map((e) => ({ value: e, weight: e.weight })),
    mulberry32((dayIndex(now) ^ WORLD_SALT) | 0),
  );
}

export function eventMods(now: number): EventMods {
  return { ...NEUTRAL_MODS, ...worldEventFor(now).mods };
}

/** The income multiplier in force at one INSTANT. Sampled per segment by
 *  accruedIncome — never read once per request. */
export function incomeMultAt(t: number): number {
  return eventMods(t).income;
}

/** Every UTC midnight strictly inside (from, to). A boundary exactly at `from`
 *  or `to` yields nothing, matching accruedIncome's strict knee guard. */
export function utcMidnightsBetween(from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = (Math.floor(from / DAY_MS) + 1) * DAY_MS; m < to; m += DAY_MS) out.push(m);
  return out;
}

export type Season = 'wet' | 'dry' | 'cold';
const SEASONS: Season[] = ['wet', 'dry', 'cold'];
export const SEASON_DAYS = 30;

// Seasons are COSMETIC. They re-tint the park map ground and name a line on
// /world, and carry no modifier at all — which is what removes every
// season×event stacking question. Adding modifiers later is purely additive.
export function seasonFor(now: number): Season {
  return SEASONS[Math.floor(dayIndex(now) / SEASON_DAYS) % SEASONS.length];
}

export function seasonDay(now: number): number {
  return (dayIndex(now) % SEASON_DAYS) + 1;
}
