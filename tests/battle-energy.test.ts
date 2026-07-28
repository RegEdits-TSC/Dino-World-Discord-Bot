import { describe, it, expect } from 'vitest';
import { settleEnergy } from '../src/data/battle/energy.js';
import { ENERGY_CAP, ENERGY_REGEN_MS } from '../src/data/battle/constants.js';

describe('settleEnergy', () => {
  it('zero elapsed below cap is a no-op', () => {
    expect(settleEnergy(5, 1_000_000, 1_000_000)).toEqual({ energy: 5, updatedAtMs: 1_000_000 });
  });
  it('sub-tick elapsed grants nothing and keeps updatedAt (fractional progress preserved)', () => {
    expect(settleEnergy(5, 1_000_000, 1_000_000 + ENERGY_REGEN_MS - 1))
      .toEqual({ energy: 5, updatedAtMs: 1_000_000 });
  });
  it('advances updatedAt by whole ticks only, banking the partial tick', () => {
    // 2.5 ticks elapsed -> +2 energy; the half tick of progress stays banked in updatedAt
    const now = 1_000_000 + 2 * ENERGY_REGEN_MS + ENERGY_REGEN_MS / 2;
    expect(settleEnergy(5, 1_000_000, now))
      .toEqual({ energy: 7, updatedAtMs: 1_000_000 + 2 * ENERGY_REGEN_MS });
  });
  it('clamps at the cap and snaps updatedAt to now (no banked overflow)', () => {
    // 6 whole ticks but only 1 needed: energy caps, overshoot is discarded
    expect(settleEnergy(9, 0, 6 * ENERGY_REGEN_MS))
      .toEqual({ energy: ENERGY_CAP, updatedAtMs: 6 * ENERGY_REGEN_MS });
    // fractional progress past the capping tick is discarded too
    expect(settleEnergy(9, 0, ENERGY_REGEN_MS + 299_999))
      .toEqual({ energy: ENERGY_CAP, updatedAtMs: ENERGY_REGEN_MS + 299_999 });
  });
  it('exactly-at-cap boundary: capped pools track now even with zero ticks', () => {
    // already at cap, partial tick elapsed -> updatedAt snaps forward so no progress accrues
    expect(settleEnergy(ENERGY_CAP, 1_000_000, 1_300_000))
      .toEqual({ energy: ENERGY_CAP, updatedAtMs: 1_300_000 });
    // reaching cap exactly on a tick boundary
    expect(settleEnergy(9, 0, ENERGY_REGEN_MS))
      .toEqual({ energy: ENERGY_CAP, updatedAtMs: ENERGY_REGEN_MS });
  });
  it('large elapsed refills fully and snaps to now', () => {
    const now = 1_000 * ENERGY_REGEN_MS + 123_456;
    expect(settleEnergy(0, 0, now)).toEqual({ energy: ENERGY_CAP, updatedAtMs: now });
  });
});
