import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/core/rolls.js';
import {
  dayIndex, worldEventFor, eventMods, incomeMultAt, utcMidnightsBetween,
  seasonFor, seasonDay, SEASON_DAYS,
} from '../src/core/world.js';
import { WORLD_EVENTS, NEUTRAL_MODS } from '../src/data/world-events.js';

const DAY = 86_400_000;

describe('world event derivation', () => {
  it('is deterministic — the same day always yields the same event', () => {
    for (const d of [0, 5, 208, 20_600]) {
      expect(worldEventFor(d * DAY).id).toBe(worldEventFor(d * DAY + DAY - 1).id);
    }
  });

  it('changes at the UTC midnight boundary, not before', () => {
    expect(worldEventFor(4 * DAY + DAY - 1).id).toBe('clear_skies');
    expect(worldEventFor(5 * DAY).id).toBe('heat_wave');
  });

  // THE LOAD-BEARING TEST. makeCtx defaults nowMs to 0, so the whole existing
  // suite runs on day 0. If this fails, roughly a dozen unrelated test files
  // are about to fail with multiplied fixtures — fix the salt, not them.
  it('keeps UTC days 0-4 calm, because the whole test suite lives there', () => {
    for (const d of [0, 1, 2, 3, 4]) {
      expect(worldEventFor(d * DAY).id, `day ${d}`).toBe('clear_skies');
    }
  });

  it('pins the day fixtures the rest of the suite selects events by', () => {
    const at = (d: number) => worldEventFor(d * DAY).id;
    expect(at(5)).toBe('heat_wave');
    expect(at(7)).toBe('blood_moon');
    expect(at(8)).toBe('cold_snap');
    expect(at(10)).toBe('amber_storm');
    expect(at(14)).toBe('fossil_rush');
    expect(at(18)).toBe('bumper_harvest');
    expect(at(27)).toBe('migration_season');
    expect(at(38)).toBe('market_panic');
    // The income-seam fixture used by tests/world-income.test.ts.
    expect(at(208)).toBe('heat_wave');
    expect(at(209)).toBe('cold_snap');
  });

  it('matches the declared weights over 120,000 days', () => {
    const counts = new Map<string, number>();
    const N = 120_000;
    for (let d = 0; d < N; d++) {
      const id = worldEventFor(d * DAY).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = WORLD_EVENTS.reduce((s, e) => s + e.weight, 0);
    for (const e of WORLD_EVENTS) {
      const share = (counts.get(e.id) ?? 0) / N;
      expect(Math.abs(share - e.weight / total), `${e.id} share ${share}`).toBeLessThan(0.01);
    }
  });

  // The shop seeds mulberry32(day) raw. Without the salt, "Market Panic day"
  // would imply one fixed shop rotation forever.
  it('draws from a stream independent of the shop\'s unsalted mulberry32(day)', () => {
    let agree = 0;
    const N = 10_000;
    for (let d = 0; d < N; d++) {
      const shopFirst = mulberry32(d)() < 1 / 3;
      const worldCalm = worldEventFor(d * DAY).id === 'clear_skies';
      if (shopFirst === worldCalm) agree++;
    }
    // Both streams land "true" with probability 1/3 (clear_skies is weight
    // 4 of 12, matching the shop's own `< 1/3`), so two INDEPENDENT such
    // streams agree at rate p^2 + (1-p)^2 = 5/9 — not 1/2, which is only the
    // agreement rate for two independent *fair-coin* streams. A shared
    // stream would agree 100% of the time regardless.
    expect(Math.abs(agree / N - 5 / 9)).toBeLessThan(0.03);
  });
});

describe('eventMods', () => {
  it('returns fully-neutral mods on a calm day', () => {
    expect(eventMods(0)).toEqual(NEUTRAL_MODS);
  });

  it('overlays only the fields an event declares', () => {
    const m = eventMods(5 * DAY);            // heat_wave
    expect(m.income).toBe(1.2);
    expect(m.feedCost).toBe(1.3);
    expect(m.sellCash).toBe(1);              // untouched by heat_wave
    expect(m.hatchTraitOdds).toBeNull();
  });

  it('exposes incomeMultAt as the instant sampler', () => {
    expect(incomeMultAt(0)).toBe(1);
    expect(incomeMultAt(5 * DAY)).toBe(1.2);
    expect(incomeMultAt(8 * DAY)).toBe(0.9);
  });

  it('declares no modifier outside the EventMods contract', () => {
    const allowed = new Set(Object.keys(NEUTRAL_MODS));
    for (const e of WORLD_EVENTS) {
      for (const k of Object.keys(e.mods)) {
        expect(allowed.has(k), `${e.id} declares unknown mod '${k}'`).toBe(true);
      }
    }
  });

  it('gives Clear Skies literally nothing to do', () => {
    const calm = WORLD_EVENTS.find((e) => e.id === 'clear_skies')!;
    expect(calm.mods).toEqual({});
    expect(calm.effects).toEqual([]);
  });

  it('gives every other event both an upside and a downside line', () => {
    for (const e of WORLD_EVENTS.filter((x) => x.id !== 'clear_skies')) {
      expect(Object.keys(e.mods).length, `${e.id} mods`).toBeGreaterThanOrEqual(2);
      expect(e.effects.length, `${e.id} effects`).toBeGreaterThanOrEqual(2);
    }
  });

  it('stores an emoji NAME, never a resolved tag', () => {
    for (const e of WORLD_EVENTS) {
      expect(e.emoji, e.id).toMatch(/^dw_event_[a-z_]+$/);
      expect(e.emoji).not.toContain('<');
    }
  });

  it('has unique ids', () => {
    expect(new Set(WORLD_EVENTS.map((e) => e.id)).size).toBe(WORLD_EVENTS.length);
  });
});

describe('utcMidnightsBetween', () => {
  it('is empty inside a single day', () => {
    expect(utcMidnightsBetween(0, DAY - 1)).toEqual([]);
  });
  it('excludes a boundary exactly at either end', () => {
    expect(utcMidnightsBetween(0, DAY)).toEqual([]);
    expect(utcMidnightsBetween(DAY, 2 * DAY)).toEqual([]);
  });
  it('lists every interior midnight for a multi-day window', () => {
    expect(utcMidnightsBetween(0, 3 * DAY + 1)).toEqual([DAY, 2 * DAY, 3 * DAY]);
  });
  it('handles a window that starts mid-day', () => {
    expect(utcMidnightsBetween(DAY / 2, DAY * 2 + DAY / 2)).toEqual([DAY, 2 * DAY]);
  });
});

describe('seasons', () => {
  it('cycles wet -> dry -> cold every 30 days', () => {
    expect(seasonFor(0)).toBe('wet');
    expect(seasonFor(29 * DAY)).toBe('wet');
    expect(seasonFor(30 * DAY)).toBe('dry');
    expect(seasonFor(60 * DAY)).toBe('cold');
    expect(seasonFor(90 * DAY)).toBe('wet');
  });
  it('reports a 1-based day within the season', () => {
    expect(seasonDay(0)).toBe(1);
    expect(seasonDay(29 * DAY)).toBe(SEASON_DAYS);
    expect(seasonDay(30 * DAY)).toBe(1);
  });
  it('exposes dayIndex as plain UTC day arithmetic', () => {
    expect(dayIndex(0)).toBe(0);
    expect(dayIndex(DAY - 1)).toBe(0);
    expect(dayIndex(DAY)).toBe(1);
  });
});
