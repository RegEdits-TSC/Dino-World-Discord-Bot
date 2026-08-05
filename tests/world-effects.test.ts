import { describe, it, expect } from 'vitest';
import { feedCostFor } from '../src/modules/care/service.js';

const DAY = 86_400_000;

describe('feed cost under world events', () => {
  it('is unchanged on a calm day', () => {
    expect(feedCostFor('rare', [], 0)).toBe(20);
    expect(feedCostFor('common', [], 0)).toBe(5);
  });

  it('rises 30% during a Heat Wave', () => {
    expect(feedCostFor('rare', [], 5 * DAY)).toBe(26);      // 20 * 1.3
  });

  it('falls 25% during a Cold Snap', () => {
    expect(feedCostFor('rare', [], 8 * DAY)).toBe(15);      // 20 * 0.75
  });

  it('composes with the Thrifty trait inside the never-free floor', () => {
    // common feedCost 5, thrifty 0.75, cold snap 0.75 => 2.8125 -> round 3
    expect(feedCostFor('common', ['thrifty'], 8 * DAY)).toBe(3);
  });

  it('applies the event multiplier before rounding, not after the floor', () => {
    // common feedCost 5 * heat wave 1.3 = 6.5 -> round 7. Rounding the trait
    // product first (5 -> 5) and multiplying the event factor in afterward
    // would yield 5 * 1.3 = 6.5, a non-integer food cost — proof the two
    // orderings genuinely diverge, unlike the Thrifty/Cold-Snap case above.
    expect(feedCostFor('common', [], 5 * DAY)).toBe(7);
  });

  it('never returns less than one unit', () => {
    expect(feedCostFor('common', ['thrifty'], 8 * DAY)).toBeGreaterThanOrEqual(1);
  });
});
