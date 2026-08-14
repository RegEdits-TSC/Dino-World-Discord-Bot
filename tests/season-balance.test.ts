import { describe, it, expect } from 'vitest';
import { SEASON_SOURCES, SEASON_RUNGS, SEASON_CAPSTONE, sourcePoints } from '../src/data/seasons.js';
import type { StatId } from '../src/core/stats.js';

// The MODERATE PROFILE: the low end of each source's measured daily band, over 30 days.
// Commerce scores ZERO on purpose — a player who neither trades nor shops must still
// clear the capstone, so the profile that sizes the rungs assumes they do not.
const MODERATE_PER_DAY: Partial<Record<StatId, number>> = {
  battles_fought: 30,
  expeditions_claimed: 1.5,
  eggs_hatched: 2,
  breedings_claimed: 1,
  dinos_fed: 10,
  dinos_sold: 1,
  splices_done: 0.5,
  income_collections: 2,
};

function pointsAfter(days: number, exclude: string[] = []): number {
  const deltas: Partial<Record<StatId, number>> = {};
  for (const [stat, perDay] of Object.entries(MODERATE_PER_DAY)) {
    deltas[stat as StatId] = Math.floor(perDay * days);
  }
  return SEASON_SOURCES
    .filter((s) => !exclude.includes(s.id))
    .reduce((sum, src) => sum + sourcePoints(src, deltas), 0);
}

describe('season balance', () => {
  it('the moderate profile clears the capstone inside 30 days', () => {
    expect(pointsAfter(30)).toBeGreaterThanOrEqual(SEASON_CAPSTONE);
    // …with real slack, not by a single point.
    const day = [...Array(31).keys()].find((d) => pointsAfter(d) >= SEASON_CAPSTONE)!;
    expect(day).toBeLessThanOrEqual(23);
  });

  // The Gene Lab gate, made falsifiable. 270 points sit behind a 20,000-cash lot; a
  // lab-less player must still clear the season, and any retune that pushes them past
  // day 30 fails HERE rather than in a player's inbox.
  it('a lab-less moderate profile still clears inside 30 days', () => {
    const day = [...Array(31).keys()].find((d) => pointsAfter(d, ['genelab', 'splicing']) >= SEASON_CAPSTONE);
    expect(day, 'a Gene-Lab-less player can no longer clear the season').toBeDefined();
    expect(day!).toBeLessThanOrEqual(30);
  });

  // THE GUARD ON THE UNGATED SOURCES. Five sources have no real-time gate at all, so a
  // determined player can bank all of them on day one. That total must stay below the
  // fifth rung — if any of those five caps is ever raised, this is what breaks first.
  it('the day-1 bankable pool stays below the fifth rung', () => {
    const UNGATED = ['care', 'sales', 'splicing', 'commerce', 'collections'];
    const pool = SEASON_SOURCES.filter((s) => UNGATED.includes(s.id))
      .reduce((sum, s) => sum + s.cap, 0);
    expect(pool).toBe(430);
    expect(pool).toBeLessThan(SEASON_RUNGS[4].points);
    expect(pool / SEASON_CAPSTONE).toBeLessThan(0.55);
  });

  it('a 10-day lapsed player lands mid-ladder', () => {
    const p = pointsAfter(10);
    expect(p).toBeGreaterThanOrEqual(SEASON_RUNGS[3].points);
    expect(p).toBeLessThan(SEASON_RUNGS[5].points);
  });
});
